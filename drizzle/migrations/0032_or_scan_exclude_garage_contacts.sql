CREATE OR REPLACE FUNCTION public.norm_contact(_v text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT btrim(regexp_replace(lower(public.unaccent(coalesce(_v,''))), '[^a-z0-9]+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.is_garage_contact(_kind text, _v text, _site uuid DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE n text; d text; s record;
BEGIN
  IF coalesce(btrim(_v),'') = '' THEN RETURN false; END IF;
  IF _kind = 'email' THEN
    n := lower(btrim(_v)); d := split_part(n, '@', 2);
    IF d IN ('dda-lalinde.fr','garagecastillon.fr') THEN RETURN true; END IF;
    RETURN EXISTS (SELECT 1 FROM sites WHERE lower(email_from_address) = n
      OR (split_part(lower(email_from_address),'@',2) = d AND d !~ '^(gmail|hotmail|outlook|yahoo|orange|free|sfr|wanadoo|laposte|icloud)\.'));
  ELSIF _kind = 'phone' THEN
    n := regexp_replace(_v, '\D', '', 'g'); IF n ~ '^33\d{9}$' THEN n := '0'||substr(n,3); END IF;
    IF length(n) < 9 THEN RETURN false; END IF;
    RETURN n IN ('0553247718') OR EXISTS (SELECT 1 FROM sites WHERE regexp_replace(coalesce(phone,''),'\D','','g') = n);
  ELSIF _kind = 'address' THEN
    n := norm_contact(_v);
    RETURN n IN ('27 avenue eugene leroy') OR EXISTS (SELECT 1 FROM sites WHERE coalesce(address,'') <> '' AND norm_contact(address) = n);
  ELSIF _kind = 'name' THEN
    n := norm_contact(_v);
    IF n = '' THEN RETURN false; END IF;
    IF n IN ('dda','sas dda') OR n LIKE '%damien digoin automobile%' OR n LIKE '%garage castillon veyssiere%' THEN RETURN true; END IF;
    FOR s IN SELECT legal_name, name FROM sites LOOP
      IF length(norm_contact(s.legal_name)) >= 10 AND n LIKE '%'||norm_contact(s.legal_name)||'%' THEN RETURN true; END IF;
      IF length(norm_contact(s.name)) >= 10 AND n LIKE '%'||norm_contact(s.name)||'%' THEN RETURN true; END IF;
    END LOOP;
  END IF;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.is_internal_client(_id uuid, _site uuid DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM clients c WHERE c.id = _id AND (
    c.account_number = '004238'
    OR public.is_garage_contact('name', concat_ws(' ', c.last_name, c.first_name), _site)
    OR public.is_garage_contact('email', c.email, _site)))
$$;
REVOKE ALL ON FUNCTION public.is_garage_contact(text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_internal_client(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_garage_contact(text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_internal_client(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.norm_contact(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ensure_winmotor_dossier_full(_site uuid, _or_number text, _data jsonb, _user_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF public.is_garage_contact('email', _email, _site) THEN _email := NULL; c := c - 'email'; END IF;
  IF public.is_garage_contact('phone', _ph, _site) THEN _ph := NULL; c := c - 'phone'; END IF;
  IF public.is_garage_contact('phone', _mo, _site) THEN _mo := NULL; c := c - 'mobile'; END IF;
  IF public.is_garage_contact('address', c->>'address', _site) THEN c := c - 'address' - 'postal_code' - 'city'; END IF;
  IF public.is_garage_contact('name', concat_ws(' ', c->>'last_name', c->>'first_name'), _site) OR public.is_garage_contact('name', _ln, _site) THEN
    _ln := NULL; c := c - 'last_name' - 'first_name' - 'account_number';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('wm_dossier:' || _site::text || ':' || _num));

  SELECT * INTO _or FROM public.repair_orders WHERE site_id = _site AND or_number = _num LIMIT 1;
  IF FOUND THEN
    _id := _or.id; _veh := _or.vehicle_id; _cli := _or.client_id;
  ELSE
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
    cur := to_jsonb(_vr)->>k;
    IF rd IS NOT NULL THEN
      IF coalesce(cur,'') = '' THEN EXECUTE format('UPDATE public.vehicles SET %I = $1 WHERE id = $2', k) USING rd, _veh;
      ELSIF public.norm_contact(cur) <> public.norm_contact(rd) THEN _conf := _conf || jsonb_build_object('entity','vehicle','id',_veh,'field',k,'current',cur,'read',rd); END IF;
    END IF;
  END LOOP;
  IF _km IS NOT NULL AND (_vr.last_mileage IS NULL OR _km > _vr.last_mileage) THEN
    UPDATE public.vehicles SET last_mileage = _km, last_mileage_at = now() WHERE id = _veh;
  END IF;

  IF _cli IS NOT NULL AND public.is_internal_client(_cli, _site) THEN _cli := NULL; END IF;
  IF _vr.client_id IS NOT NULL AND NOT public.is_internal_client(_vr.client_id, _site) THEN _cli := coalesce(_cli, _vr.client_id); END IF;
  IF _cli IS NULL AND _email IS NOT NULL THEN SELECT id INTO _cli FROM public.clients WHERE lower(email) = _email AND NOT public.is_internal_client(id, _site) ORDER BY created_at LIMIT 1; END IF;
  IF _cli IS NULL AND (_ph IS NOT NULL OR _mo IS NOT NULL) THEN
    SELECT id INTO _cli FROM public.clients
      WHERE (regexp_replace(coalesce(phone,''),'\D','','g') IN (coalesce(_ph,'-'), coalesce(_mo,'-'))
         OR regexp_replace(coalesce(mobile,''),'\D','','g') IN (coalesce(_ph,'-'), coalesce(_mo,'-'))) AND NOT public.is_internal_client(id, _site)
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
      cur := to_jsonb(_cr)->>k;
      IF coalesce(cur,'') = '' THEN
        EXECUTE format('UPDATE public.clients SET %I = $1 WHERE id = $2', k) USING rd, _cli;
      ELSIF (k IN ('phone','mobile') AND regexp_replace(cur,'\D','','g') <> regexp_replace(rd,'\D','','g'))
         OR (k NOT IN ('phone','mobile') AND public.norm_contact(cur) <> public.norm_contact(rd)) THEN
        _conf := _conf || jsonb_build_object('entity','client','id',_cli,'field',k,'current',cur,'read',rd);
      END IF;
    END LOOP;
  END IF;
  IF _cli IS NOT NULL AND (_vr.client_id IS NULL OR public.is_internal_client(_vr.client_id, _site)) THEN UPDATE public.vehicles SET client_id = _cli WHERE id = _veh; END IF;

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
      client_id = CASE WHEN client_id IS NULL OR public.is_internal_client(client_id, _site) THEN coalesce(_cli, client_id) ELSE client_id END,
      or_date = coalesce(or_date, CASE WHEN coalesce(o->>'or_date','') ~ '^\d{4}-\d{2}-\d{2}' THEN (substr(o->>'or_date',1,10))::date END),
      requested_work = coalesce(requested_work, nullif(btrim(coalesce(o->>'requested_work','')),'')),
      client_remarks = coalesce(client_remarks, nullif(btrim(coalesce(o->>'client_remarks','')),'')),
      mileage_in = coalesce(mileage_in, _km)
    WHERE id = _id;
  END IF;

  RETURN jsonb_build_object('id', _id, 'created', _created, 'vehicle_id', _veh, 'client_id', _cli, 'plate_source', _source, 'conflicts', _conf);
END $function$;