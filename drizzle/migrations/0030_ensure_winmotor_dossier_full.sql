CREATE OR REPLACE FUNCTION public.ensure_winmotor_dossier_full(_site uuid, _or_number text, _data jsonb, _user_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _num text := btrim(coalesce(_or_number, ''));
  c jsonb := coalesce(_data->'client', '{}'::jsonb);
  v jsonb := coalesce(_data->'vehicle', '{}'::jsonb);
  o jsonb := coalesce(_data->'order', '{}'::jsonb);
  _plate text := upper(regexp_replace(coalesce(v->>'plate', ''), '[^A-Za-z0-9]', '', 'g'));
  _vin text := nullif(upper(regexp_replace(coalesce(v->>'vin', ''), '[^A-Za-z0-9]', '', 'g')), '');
  _km int := nullif(regexp_replace(coalesce(v->>'mileage', ''), '\D', '', 'g'), '')::int;
  _email text := nullif(lower(btrim(coalesce(c->>'email', ''))), '');
  _ph text := nullif(regexp_replace(coalesce(c->>'phone', ''), '\D', '', 'g'), '');
  _mo text := nullif(regexp_replace(coalesce(c->>'mobile', ''), '\D', '', 'g'), '');
  _ln text := nullif(btrim(coalesce(c->>'last_name', '')), '');
  _id uuid; _created boolean := false; _veh uuid; _cli uuid; _wm record; _vr record; _cr record; _or record;
  _conf jsonb := '[]'::jsonb; _source text := 'lecture'; k text; cur text; rd text; _pdisp text;
BEGIN
  IF _uid IS NULL OR NOT public.is_active_user(_uid) THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF _site IS NULL THEN RETURN jsonb_build_object('error', 'site_required'); END IF;
  IF NOT public.user_can_access_site(_uid, _site) THEN RAISE EXCEPTION 'site not allowed'; END IF;
  IF _num !~ '^[0-9]{3,8}$' THEN RETURN jsonb_build_object('error', 'invalid_or_number'); END IF;
  IF _vin IS NOT NULL AND length(_vin) <> 17 THEN _vin := NULL; END IF;
  IF _km IS NOT NULL AND (_km < 1 OR _km > 2000000) THEN _km := NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('wm_dossier:' || _site::text || ':' || _num));

  -- 1) Dossier existant pour site + n° OR
  SELECT * INTO _or FROM public.repair_orders WHERE site_id = _site AND or_number = _num LIMIT 1;
  IF FOUND THEN
    _id := _or.id; _veh := _or.vehicle_id; _cli := _or.client_id;
  ELSE
    -- 2) Véhicule : plaque, puis VIN, puis historique WinMotor de ce site + OR
    IF _plate <> '' THEN SELECT id INTO _veh FROM public.vehicles WHERE plate_normalized = _plate ORDER BY created_at LIMIT 1; END IF;
    IF _veh IS NULL AND _vin IS NOT NULL THEN SELECT id INTO _veh FROM public.vehicles WHERE upper(vin) = _vin ORDER BY created_at LIMIT 1; END IF;
    IF _veh IS NULL THEN
      SELECT plate_normalized, vin INTO _wm FROM public.winmotor_invoices
        WHERE site_id = _site AND or_number = _num AND (coalesce(plate_normalized,'') <> '' OR coalesce(vin,'') <> '')
        ORDER BY invoice_date DESC NULLS LAST LIMIT 1;
      IF FOUND THEN
        IF _plate = '' AND coalesce(_wm.plate_normalized,'') <> '' THEN _plate := _wm.plate_normalized; _source := 'historique_winmotor'; END IF;
        IF _vin IS NULL AND length(coalesce(_wm.vin,'')) = 17 THEN _vin := upper(_wm.vin); END IF;
        IF _plate <> '' THEN SELECT id INTO _veh FROM public.vehicles WHERE plate_normalized = _plate ORDER BY created_at LIMIT 1; END IF;
        IF _veh IS NULL AND _vin IS NOT NULL THEN SELECT id INTO _veh FROM public.vehicles WHERE upper(vin) = _vin ORDER BY created_at LIMIT 1; END IF;
      END IF;
    END IF;
    -- Ancienne fiche sans site, même n° OR et même véhicule : reprise
    IF _veh IS NOT NULL THEN
      SELECT id INTO _id FROM public.repair_orders WHERE site_id IS NULL AND or_number = _num AND vehicle_id = _veh LIMIT 1;
      IF _id IS NOT NULL THEN UPDATE public.repair_orders SET site_id = _site WHERE id = _id; END IF;
    END IF;
    IF _veh IS NULL THEN
      IF _plate = '' THEN RETURN jsonb_build_object('needs_plate', true); END IF;
      IF length(_plate) < 4 OR length(_plate) > 12 THEN RETURN jsonb_build_object('error', 'invalid_plate'); END IF;
      _pdisp := CASE WHEN _plate ~ '^[A-Z]{2}[0-9]{3}[A-Z]{2}$' THEN substr(_plate,1,2)||'-'||substr(_plate,3,3)||'-'||substr(_plate,6,2) ELSE _plate END;
      INSERT INTO public.vehicles (plate, plate_normalized, vin, brand, model, last_mileage, last_mileage_at)
      VALUES (_pdisp, _plate, _vin, nullif(btrim(coalesce(v->>'brand','')),''), nullif(btrim(coalesce(v->>'model','')),''), _km, CASE WHEN _km IS NOT NULL THEN now() END)
      RETURNING id INTO _veh;
    END IF;
  END IF;

  -- 3) Enrichissement du véhicule : compléter, jamais écraser ; conflits signalés
  SELECT * INTO _vr FROM public.vehicles WHERE id = _veh;
  IF _plate <> '' AND _vr.plate_normalized <> _plate THEN
    _conf := _conf || jsonb_build_object('entity','vehicle','id',_veh,'field','plate','current',_vr.plate,'read',v->>'plate');
  END IF;
  IF _vin IS NOT NULL THEN
    IF coalesce(_vr.vin,'') = '' THEN UPDATE public.vehicles SET vin = _vin WHERE id = _veh;
    ELSIF upper(_vr.vin) <> _vin THEN _conf := _conf || jsonb_build_object('entity','vehicle','id',_veh,'field','vin','current',_vr.vin,'read',_vin); END IF;
  END IF;
  FOREACH k IN ARRAY ARRAY['brand','model'] LOOP
    rd := nullif(btrim(coalesce(v->>k,'')),'');
    cur := CASE k WHEN 'brand' THEN _vr.brand ELSE _vr.model END;
    IF rd IS NOT NULL THEN
      IF coalesce(cur,'') = '' THEN EXECUTE format('UPDATE public.vehicles SET %I = $1 WHERE id = $2', k) USING rd, _veh;
      ELSIF upper(cur) <> upper(rd) THEN _conf := _conf || jsonb_build_object('entity','vehicle','id',_veh,'field',k,'current',cur,'read',rd); END IF;
    END IF;
  END LOOP;
  IF _km IS NOT NULL AND (_vr.last_mileage IS NULL OR _km > _vr.last_mileage) THEN
    UPDATE public.vehicles SET last_mileage = _km, last_mileage_at = now() WHERE id = _veh;
  END IF;

  -- 4) Client : lié au dossier/véhicule, puis e-mail, puis téléphone ; sinon création si nom lu
  _cli := coalesce(_cli, _vr.client_id);
  IF _cli IS NULL AND _email IS NOT NULL THEN SELECT id INTO _cli FROM public.clients WHERE lower(email) = _email ORDER BY created_at LIMIT 1; END IF;
  IF _cli IS NULL AND (_ph IS NOT NULL OR _mo IS NOT NULL) THEN
    SELECT id INTO _cli FROM public.clients
      WHERE regexp_replace(coalesce(phone,''),'\D','','g') IN (coalesce(_ph,'-'), coalesce(_mo,'-'))
         OR regexp_replace(coalesce(mobile,''),'\D','','g') IN (coalesce(_ph,'-'), coalesce(_mo,'-'))
      ORDER BY created_at LIMIT 1;
  END IF;
  IF _cli IS NULL AND _ln IS NOT NULL THEN
    INSERT INTO public.clients (account_number, last_name, first_name, address, address_extra, postal_code, city, phone, mobile, email)
    VALUES (nullif(btrim(coalesce(c->>'account_number','')),''), _ln, nullif(btrim(coalesce(c->>'first_name','')),''),
      nullif(btrim(coalesce(c->>'address','')),''), nullif(btrim(coalesce(c->>'address_extra','')),''),
      nullif(btrim(coalesce(c->>'postal_code','')),''), nullif(btrim(coalesce(c->>'city','')),''),
      nullif(btrim(coalesce(c->>'phone','')),''), nullif(btrim(coalesce(c->>'mobile','')),''), _email)
    RETURNING id INTO _cli;
  ELSIF _cli IS NOT NULL THEN
    SELECT * INTO _cr FROM public.clients WHERE id = _cli;
    FOREACH k IN ARRAY ARRAY['account_number','last_name','first_name','address','address_extra','postal_code','city','phone','mobile','email'] LOOP
      rd := nullif(btrim(coalesce(c->>k,'')),'');
      IF rd IS NULL THEN CONTINUE; END IF;
      EXECUTE format('SELECT ($1).%I::text', k) USING _cr INTO cur;
      IF coalesce(cur,'') = '' THEN
        EXECUTE format('UPDATE public.clients SET %I = $1 WHERE id = $2', k) USING rd, _cli;
      ELSIF (k IN ('phone','mobile') AND regexp_replace(cur,'\D','','g') <> regexp_replace(rd,'\D','','g'))
         OR (k NOT IN ('phone','mobile') AND upper(regexp_replace(cur,'\s+',' ','g')) <> upper(regexp_replace(rd,'\s+',' ','g'))) THEN
        _conf := _conf || jsonb_build_object('entity','client','id',_cli,'field',k,'current',cur,'read',rd);
      END IF;
    END LOOP;
  END IF;
  IF _cli IS NOT NULL AND _vr.client_id IS NULL THEN UPDATE public.vehicles SET client_id = _cli WHERE id = _veh; END IF;

  -- 5) Dossier : créer si absent (n° OR WinMotor conservé tel quel), sinon compléter
  IF _id IS NULL THEN
    INSERT INTO public.repair_orders (vehicle_id, client_id, site_id, or_number, internal_ref, record_type, or_status,
      or_source, or_linked_at, or_date, requested_work, client_remarks, mileage_in, created_by, created_by_name)
    VALUES (_veh, _cli, _site, _num, public.next_dda_order_ref(), 'or_winmotor', 'or_complet', 'scan_atelier', now(),
      CASE WHEN coalesce(o->>'or_date','') ~ '^\d{4}-\d{2}-\d{2}' THEN (substr(o->>'or_date',1,10))::date END,
      nullif(btrim(coalesce(o->>'requested_work','')),''), nullif(btrim(coalesce(o->>'client_remarks','')),''), _km, _uid, _user_name)
    RETURNING id INTO _id;
    _created := true;
  ELSE
    UPDATE public.repair_orders SET
      client_id = coalesce(client_id, _cli),
      or_date = coalesce(or_date, CASE WHEN coalesce(o->>'or_date','') ~ '^\d{4}-\d{2}-\d{2}' THEN (substr(o->>'or_date',1,10))::date END),
      requested_work = coalesce(requested_work, nullif(btrim(coalesce(o->>'requested_work','')),'')),
      client_remarks = coalesce(client_remarks, nullif(btrim(coalesce(o->>'client_remarks','')),'')),
      mileage_in = coalesce(mileage_in, _km)
    WHERE id = _id;
  END IF;

  RETURN jsonb_build_object('id', _id, 'created', _created, 'vehicle_id', _veh, 'client_id', _cli, 'plate_source', _source, 'conflicts', _conf);
END $$;

REVOKE ALL ON FUNCTION public.ensure_winmotor_dossier_full(uuid, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_winmotor_dossier_full(uuid, text, jsonb, text) TO authenticated;

-- Application d'une valeur lue après confirmation explicite de l'utilisateur (conflit OCR).
CREATE OR REPLACE FUNCTION public.apply_dossier_conflict(_entity text, _id uuid, _field text, _value text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user(auth.uid()) THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF _entity = 'vehicle' AND _field IN ('vin','brand','model') THEN
    EXECUTE format('UPDATE public.vehicles SET %I = $1 WHERE id = $2', _field) USING nullif(btrim(_value),''), _id;
  ELSIF _entity = 'client' AND _field IN ('account_number','last_name','first_name','address','address_extra','postal_code','city','phone','mobile','email') THEN
    EXECUTE format('UPDATE public.clients SET %I = $1 WHERE id = $2', _field) USING nullif(btrim(_value),''), _id;
  ELSE RAISE EXCEPTION 'field not allowed'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.apply_dossier_conflict(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_dossier_conflict(text, uuid, text, text) TO authenticated;