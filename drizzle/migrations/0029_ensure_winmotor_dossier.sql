CREATE UNIQUE INDEX IF NOT EXISTS repair_orders_site_or_number_key
  ON public.repair_orders (site_id, or_number)
  WHERE site_id IS NOT NULL AND or_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ensure_winmotor_dossier(
  _site uuid, _or_number text, _plate text DEFAULT NULL, _user_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _num text := btrim(coalesce(_or_number, ''));
  _norm text := upper(regexp_replace(coalesce(_plate, ''), '[^A-Za-z0-9]', '', 'g'));
  _id uuid; _veh uuid; _vin text; _legacy uuid[]; _source text := 'saisie';
BEGIN
  IF _uid IS NULL OR NOT public.is_active_user(_uid) THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF _site IS NULL THEN RETURN jsonb_build_object('error', 'site_required'); END IF;
  IF NOT public.user_can_access_site(_uid, _site) THEN RAISE EXCEPTION 'site not allowed'; END IF;
  IF _num !~ '^[0-9]{3,8}$' THEN RETURN jsonb_build_object('error', 'invalid_or_number'); END IF;

  PERFORM pg_advisory_xact_lock(hashtext('wm_dossier:' || _site::text || ':' || _num));

  SELECT id INTO _id FROM public.repair_orders WHERE site_id = _site AND or_number = _num LIMIT 1;
  IF _id IS NOT NULL THEN RETURN jsonb_build_object('id', _id, 'created', false); END IF;

  IF _norm = '' THEN
    SELECT plate_normalized, vin INTO _norm, _vin FROM public.winmotor_invoices
      WHERE site_id = _site AND or_number = _num AND coalesce(plate_normalized, '') <> ''
      ORDER BY invoice_date DESC NULLS LAST LIMIT 1;
    _norm := coalesce(_norm, '');
    IF _norm <> '' THEN _source := 'historique_winmotor'; END IF;
  END IF;

  IF _norm <> '' THEN
    SELECT array_agg(r.id) INTO _legacy FROM public.repair_orders r JOIN public.vehicles v ON v.id = r.vehicle_id
      WHERE r.site_id IS NULL AND r.or_number = _num AND v.plate_normalized = _norm;
    IF array_length(_legacy, 1) = 1 THEN
      UPDATE public.repair_orders SET site_id = _site WHERE id = _legacy[1];
      RETURN jsonb_build_object('id', _legacy[1], 'created', false, 'adopted', true);
    END IF;
  END IF;

  IF _norm = '' THEN RETURN jsonb_build_object('needs_plate', true); END IF;
  IF length(_norm) < 4 OR length(_norm) > 12 THEN RETURN jsonb_build_object('error', 'invalid_plate'); END IF;

  SELECT id INTO _veh FROM public.vehicles WHERE plate_normalized = _norm ORDER BY created_at LIMIT 1;
  IF _veh IS NULL THEN
    INSERT INTO public.vehicles (plate, plate_normalized, vin)
    VALUES (CASE WHEN _norm ~ '^[A-Z]{2}[0-9]{3}[A-Z]{2}$'
                 THEN substr(_norm,1,2)||'-'||substr(_norm,3,3)||'-'||substr(_norm,6,2) ELSE _norm END,
            _norm, _vin)
    RETURNING id INTO _veh;
  END IF;

  INSERT INTO public.repair_orders (vehicle_id, site_id, or_number, internal_ref, record_type, or_status,
    or_source, or_linked_at, created_by, created_by_name)
  VALUES (_veh, _site, _num, public.next_dda_order_ref(), 'or_winmotor', 'or_complet',
    'scan_atelier', now(), _uid, _user_name)
  RETURNING id INTO _id;

  RETURN jsonb_build_object('id', _id, 'created', true, 'plate_source', _source);
END $$;

REVOKE ALL ON FUNCTION public.ensure_winmotor_dossier(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_winmotor_dossier(uuid, text, text, text) TO authenticated;