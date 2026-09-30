CREATE OR REPLACE FUNCTION public.complete_winmotor_dossier_extras(_or uuid, _data jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _r record;
  v jsonb := coalesce(_data->'vehicle', '{}'::jsonb);
  o jsonb := coalesce(_data->'order', '{}'::jsonb);
  _fr text := v->>'first_registration';
  _en text := o->>'entry_at';
  _de text := o->>'delivery_at';
BEGIN
  IF _uid IS NULL OR NOT public.is_active_user(_uid) THEN RAISE EXCEPTION 'not allowed'; END IF;
  SELECT id, site_id, vehicle_id INTO _r FROM public.repair_orders WHERE id = _or;
  IF NOT FOUND OR _r.site_id IS NULL OR NOT public.user_can_access_site(_uid, _r.site_id) THEN RAISE EXCEPTION 'site not allowed'; END IF;
  -- Champs vides seulement complétés : jamais d'écrasement.
  IF _r.vehicle_id IS NOT NULL AND coalesce(_fr,'') ~ '^\d{4}-\d{2}-\d{2}$' THEN
    UPDATE public.vehicles SET first_registration = _fr::date WHERE id = _r.vehicle_id AND first_registration IS NULL;
  END IF;
  IF coalesce(_en,'') ~ '^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$' THEN
    UPDATE public.repair_orders SET entry_at = (replace(_en,'T',' ') || CASE WHEN _en ~ 'T' THEN '' ELSE ' 00:00' END || ' Europe/Paris')::timestamptz WHERE id = _or AND entry_at IS NULL;
  END IF;
  IF coalesce(_de,'') ~ '^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$' THEN
    UPDATE public.repair_orders SET delivery_at = (replace(_de,'T',' ') || CASE WHEN _de ~ 'T' THEN '' ELSE ' 00:00' END || ' Europe/Paris')::timestamptz WHERE id = _or AND delivery_at IS NULL;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.complete_winmotor_dossier_extras(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.complete_winmotor_dossier_extras(uuid, jsonb) TO authenticated;