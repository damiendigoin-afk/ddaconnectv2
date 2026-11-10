ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS first_registration_source text;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS delivery_date_source text;

-- Lecture OR : une MEC égale à la date de livraison n'est jamais enregistrée ; provenance tracée.
CREATE OR REPLACE FUNCTION public.complete_winmotor_dossier_extras(_or uuid, _data jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _r record;
  v jsonb := coalesce(_data->'vehicle', '{}'::jsonb);
  o jsonb := coalesce(_data->'order', '{}'::jsonb);
  _fr text := v->>'first_registration';
  _frs text := coalesce(nullif(v->>'first_registration_source',''), 'ocr_or');
  _dd text := v->>'delivery_date';
  _tapv text := nullif(btrim(coalesce(v->>'tapv','')), '');
  _vo text := coalesce(v->>'last_vo_sale_date', o->>'last_vo_sale');
  _en text := o->>'entry_at';
  _de text := o->>'delivery_at';
  _n int;
BEGIN
  IF _uid IS NULL OR NOT public.is_active_user(_uid) THEN RAISE EXCEPTION 'not allowed'; END IF;
  SELECT id, site_id, vehicle_id INTO _r FROM public.repair_orders WHERE id = _or;
  IF NOT FOUND OR _r.site_id IS NULL OR NOT public.user_can_access_site(_uid, _r.site_id) THEN RAISE EXCEPTION 'site not allowed'; END IF;
  IF _frs NOT IN ('ocr_or','ixellio','manuel') THEN _frs := 'ocr_or'; END IF;
  IF _r.vehicle_id IS NOT NULL THEN
    IF coalesce(_fr,'') ~ '^\d{4}-\d{2}-\d{2}$'
       AND _fr IS DISTINCT FROM left(coalesce(_dd,''),10)
       AND _fr IS DISTINCT FROM left(coalesce(_de,''),10)
       AND _fr::date <= current_date THEN
      UPDATE public.vehicles SET first_registration = _fr::date, first_registration_source = _frs
        WHERE id = _r.vehicle_id AND first_registration IS NULL;
      GET DIAGNOSTICS _n = ROW_COUNT;
      IF _n > 0 THEN
        INSERT INTO public.field_changes (entity_type, entity_id, field, old_value, new_value, changed_by, changed_by_name)
        VALUES ('vehicle', _r.vehicle_id, 'first_registration', NULL, _fr, _uid, 'scan OR (' || _frs || ')');
      END IF;
    END IF;
    IF coalesce(_dd,'') ~ '^\d{4}-\d{2}-\d{2}$' THEN
      UPDATE public.vehicles SET delivery_date = _dd::date, delivery_date_source = 'ocr_or' WHERE id = _r.vehicle_id AND delivery_date IS NULL;
    END IF;
    IF _tapv IS NOT NULL AND length(_tapv) <= 20 THEN
      UPDATE public.vehicles SET tapv = upper(_tapv) WHERE id = _r.vehicle_id AND (tapv IS NULL OR btrim(tapv) = '');
    END IF;
    IF coalesce(_vo,'') ~ '^\d{4}-\d{2}-\d{2}$' THEN
      UPDATE public.vehicles SET last_vo_sale_date = _vo::date WHERE id = _r.vehicle_id AND last_vo_sale_date IS NULL;
    END IF;
  END IF;
  IF coalesce(_en,'') ~ '^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$' THEN
    UPDATE public.repair_orders SET entry_at = (replace(_en,'T',' ') || CASE WHEN _en ~ 'T' THEN '' ELSE ' 00:00' END || ' Europe/Paris')::timestamptz WHERE id = _or AND entry_at IS NULL;
  END IF;
  IF coalesce(_de,'') ~ '^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$' THEN
    UPDATE public.repair_orders SET delivery_at = (replace(_de,'T',' ') || CASE WHEN _de ~ 'T' THEN '' ELSE ' 00:00' END || ' Europe/Paris')::timestamptz WHERE id = _or AND delivery_at IS NULL;
  END IF;
END $function$;

-- Correction manuelle des dates véhicule depuis un tour (même terminé) : atomique, auditée, sans doublon.
CREATE OR REPLACE FUNCTION public.correct_vehicle_dates(_inspection uuid, _patch jsonb, _reason text, _user_name text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _i record;
  _v record;
  _who text := coalesce(nullif(btrim(_user_name),''), 'Utilisateur');
  _mec date; _del date; _ct date;
  _ct_mode text := _patch->>'ct_mode';          -- 'keep' | 'real' | 'theoretical'
  _proof text := nullif(btrim(coalesce(_patch->>'ct_proof','')),''); -- 'pv' | 'vignette' | 'declaration'
  _refs int := 0;
BEGIN
  IF _uid IS NULL OR NOT public.is_active_user(_uid) THEN RAISE EXCEPTION 'not allowed'; END IF;
  SELECT id, vehicle_id, site_id INTO _i FROM public.vehicle_inspections WHERE id = _inspection;
  IF NOT FOUND OR _i.vehicle_id IS NULL THEN RAISE EXCEPTION 'tour introuvable'; END IF;
  IF _i.site_id IS NOT NULL AND NOT public.user_can_access_site(_uid, _i.site_id) THEN RAISE EXCEPTION 'site not allowed'; END IF;
  SELECT * INTO _v FROM public.vehicles WHERE id = _i.vehicle_id FOR UPDATE;

  IF _patch ? 'first_registration' THEN
    _mec := nullif(_patch->>'first_registration','')::date;
    IF _mec IS NOT NULL AND (_mec > current_date OR _mec < date '1950-01-01') THEN RAISE EXCEPTION 'mec invalide'; END IF;
  ELSE _mec := _v.first_registration; END IF;
  IF _patch ? 'delivery_date' THEN
    _del := nullif(_patch->>'delivery_date','')::date;
  ELSE _del := _v.delivery_date; END IF;
  IF _ct_mode = 'real' THEN
    _ct := nullif(_patch->>'ct_due_date','')::date;
    IF _ct IS NULL THEN RAISE EXCEPTION 'date ct requise'; END IF;
    IF _proof IS NULL OR _proof NOT IN ('pv','vignette','declaration') THEN RAISE EXCEPTION 'preuve ct requise'; END IF;
    IF _mec IS NOT NULL AND _ct <= _mec THEN RAISE EXCEPTION 'ct avant mec'; END IF;
  END IF;

  IF _mec IS DISTINCT FROM _v.first_registration THEN
    UPDATE public.vehicles SET first_registration = _mec, first_registration_source = coalesce(nullif(_patch->>'first_registration_source',''),'manuel') WHERE id = _v.id;
    INSERT INTO public.field_changes (entity_type, entity_id, field, old_value, new_value, changed_by, changed_by_name)
    VALUES ('vehicle', _v.id, 'first_registration', _v.first_registration::text, _mec::text, _uid, _who || coalesce(' — ' || nullif(_reason,''), ''));
  END IF;
  IF _del IS DISTINCT FROM _v.delivery_date THEN
    UPDATE public.vehicles SET delivery_date = _del, delivery_date_source = 'manuel' WHERE id = _v.id;
    INSERT INTO public.field_changes (entity_type, entity_id, field, old_value, new_value, changed_by, changed_by_name)
    VALUES ('vehicle', _v.id, 'delivery_date', _v.delivery_date::text, _del::text, _uid, _who || coalesce(' — ' || nullif(_reason,''), ''));
  END IF;

  IF _ct_mode IN ('real','theoretical') THEN
    IF _ct_mode = 'theoretical' THEN _ct := NULL; END IF;
    UPDATE public.vehicles SET ct_due_date = _ct,
      ct_source = CASE WHEN _ct_mode = 'real' THEN 'manuel' ELSE 'theorique' END,
      ct_read_at = now(), ct_manually_corrected = true WHERE id = _v.id;
    INSERT INTO public.field_changes (entity_type, entity_id, field, old_value, new_value, changed_by, changed_by_name)
    VALUES ('vehicle', _v.id, 'ct_due_date', _v.ct_due_date::text,
      coalesce(_ct::text, 'aucun CT réel (premier CT théorique)') || CASE WHEN _proof IS NOT NULL THEN ' [preuve: ' || _proof || ']' ELSE '' END,
      _uid, _who || coalesce(' — ' || nullif(_reason,''), ''));
    UPDATE public.inspection_points SET ct_due_date = _ct,
      ct_source = CASE WHEN _ct_mode = 'real' THEN 'manuel' ELSE 'theorique' END,
      ct_read_at = now(), ct_manually_corrected = true,
      comment = CASE WHEN _patch ? 'ct_comment' THEN _patch->>'ct_comment' ELSE comment END
      WHERE inspection_id = _inspection AND point_key = 'controle_technique';
  ELSIF _patch ? 'ct_comment' THEN
    UPDATE public.inspection_points SET comment = _patch->>'ct_comment'
      WHERE inspection_id = _inspection AND point_key = 'controle_technique';
  END IF;

  -- Référentiel : fiches existantes de la même immatriculation mises à jour, jamais créées.
  UPDATE public.ref_vehicles SET
    first_registration_date = _mec,
    delivery_date = _del,
    ct_due_date = CASE WHEN _ct_mode IN ('real','theoretical') THEN _ct ELSE ct_due_date END,
    next_ct_date = CASE WHEN _ct_mode IN ('real','theoretical') THEN _ct ELSE next_ct_date END,
    updated_at = now()
  WHERE registration_normalized = _v.plate_normalized
    AND (_mec IS DISTINCT FROM _v.first_registration OR _del IS DISTINCT FROM _v.delivery_date OR _ct_mode IN ('real','theoretical'));
  GET DIAGNOSTICS _refs = ROW_COUNT;

  UPDATE public.vehicle_inspections SET last_modified_at = now(), last_modified_by_name = _who WHERE id = _inspection;
  RETURN jsonb_build_object('ok', true, 'vehicle_id', _v.id, 'ref_updated', _refs);
END $function$;

REVOKE ALL ON FUNCTION public.correct_vehicle_dates(uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_vehicle_dates(uuid, jsonb, text, text) TO authenticated;