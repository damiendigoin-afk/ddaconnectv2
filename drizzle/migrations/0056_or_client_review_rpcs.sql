CREATE OR REPLACE FUNCTION public.name_tokens(_v text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(array_agg(t), '{}') FROM unnest(regexp_split_to_array(public.norm_contact(_v), ' ')) t
  WHERE length(t) >= 3 AND t NOT IN ('sas','sarl','eurl','damien','digoin','automobile','castillon','veyssiere','garage','mme','mlle','monsieur','madame')
$$;

CREATE OR REPLACE FUNCTION public.or_client_candidates(_or uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); ro record; cl record; cap jsonb; acc text; pl text; vn text; toks text[]; out jsonb := '[]'::jsonb; r record;
  am boolean; vm boolean; nm boolean; ok boolean;
BEGIN
  IF _uid IS NULL OR NOT public.is_active_user(_uid) THEN RAISE EXCEPTION 'not allowed'; END IF;
  SELECT * INTO ro FROM repair_orders WHERE id = _or;
  IF NOT FOUND OR ro.site_id IS NULL THEN RETURN out; END IF;
  IF NOT public.user_can_access_site(_uid, ro.site_id) THEN RAISE EXCEPTION 'site not allowed'; END IF;
  SELECT * INTO cl FROM clients WHERE id = ro.client_id;
  SELECT data INTO cap FROM or_client_captures WHERE repair_order_id = _or AND status = 'pending' ORDER BY created_at DESC LIMIT 1;
  acc := ltrim(coalesce(nullif(btrim(cl.account_number),''), cap->>'account_number', ''), '0');
  IF acc = '4238' THEN acc := ''; END IF;
  SELECT plate_normalized, upper(vin) INTO pl, vn FROM vehicles WHERE id = ro.vehicle_id;
  toks := public.name_tokens(concat_ws(' ', cl.last_name, cl.first_name, cap->>'last_name', cap->>'first_name'));
  FOR r IN
    SELECT cu.id, cu.source_customer_id, cu.last_name, cu.first_name, cu.company_name,
      (SELECT string_agg(rv.registration_display, ', ') FROM customer_vehicle_relations x JOIN ref_vehicles rv ON rv.id = x.vehicle_id WHERE x.customer_id = cu.id AND x.active) AS plates,
      EXISTS (SELECT 1 FROM customer_vehicle_relations x JOIN ref_vehicles rv ON rv.id = x.vehicle_id
        WHERE x.customer_id = cu.id AND x.active AND ((coalesce(pl,'') <> '' AND rv.registration_normalized = pl) OR (coalesce(vn,'') <> '' AND rv.vin_normalized = vn))) AS veh_match
    FROM customers cu
    WHERE cu.site_id = ro.site_id AND (
      (acc <> '' AND ltrim(coalesce(cu.source_customer_id,''), '0') = acc)
      OR EXISTS (SELECT 1 FROM customer_vehicle_relations x JOIN ref_vehicles rv ON rv.id = x.vehicle_id
        WHERE x.customer_id = cu.id AND x.active AND ((coalesce(pl,'') <> '' AND rv.registration_normalized = pl) OR (coalesce(vn,'') <> '' AND rv.vin_normalized = vn))))
    LIMIT 10
  LOOP
    am := acc <> '' AND ltrim(coalesce(r.source_customer_id,''), '0') = acc;
    vm := r.veh_match;
    nm := toks && public.name_tokens(concat_ws(' ', r.last_name, r.first_name, r.company_name));
    ok := (am AND (nm OR vm)) OR (vm AND (nm OR cardinality(toks) = 0));
    IF ok THEN
      out := out || jsonb_build_object('customer_id', r.id, 'account_number', r.source_customer_id,
        'last_name', r.last_name, 'first_name', r.first_name, 'company_name', r.company_name, 'plates', r.plates,
        'account_match', am, 'vehicle_match', vm, 'name_match', nm,
        'contacts', (SELECT coalesce(jsonb_agg(jsonb_build_object('type', type, 'value', value)), '[]') FROM customer_contacts WHERE customer_id = r.id AND active),
        'address', (SELECT jsonb_build_object('line', address_line_1, 'postal_code', postal_code, 'city', city) FROM customer_addresses WHERE customer_id = r.id ORDER BY (type = 'MAIN') DESC LIMIT 1));
    END IF;
  END LOOP;
  RETURN out;
END $$;

CREATE OR REPLACE FUNCTION public.link_or_client_from_referential(_or uuid, _customer uuid, _user_name text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); ro record; cu record; veh record; cap jsonb; _ln text; _fn text; _cli uuid; _old uuid; k text; rd text; cur text; a record;
  mob text; tel text; mail text;
BEGIN
  IF _uid IS NULL OR NOT public.is_active_user(_uid) THEN RAISE EXCEPTION 'not allowed'; END IF;
  SELECT * INTO ro FROM repair_orders WHERE id = _or FOR UPDATE;
  IF NOT FOUND OR ro.site_id IS NULL THEN RAISE EXCEPTION 'or not found'; END IF;
  IF NOT public.user_can_access_site(_uid, ro.site_id) THEN RAISE EXCEPTION 'site not allowed'; END IF;
  SELECT * INTO cu FROM customers WHERE id = _customer;
  IF NOT FOUND OR cu.site_id IS DISTINCT FROM ro.site_id THEN RAISE EXCEPTION 'cross_site'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.or_client_candidates(_or)) e WHERE (e->>'customer_id')::uuid = _customer) THEN
    RAISE EXCEPTION 'not_coherent';
  END IF;
  _ln := coalesce(nullif(btrim(cu.last_name),''), nullif(btrim(cu.company_name),''), nullif(btrim(cu.first_name),''));
  _fn := CASE WHEN nullif(btrim(cu.last_name),'') IS NOT NULL THEN nullif(btrim(cu.first_name),'') END;
  SELECT value INTO mob FROM customer_contacts WHERE customer_id = cu.id AND active AND type = 'MOBILE' LIMIT 1;
  SELECT value INTO tel FROM customer_contacts WHERE customer_id = cu.id AND active AND type = 'PHONE' LIMIT 1;
  SELECT value INTO mail FROM customer_contacts WHERE customer_id = cu.id AND active AND type = 'EMAIL' LIMIT 1;
  SELECT * INTO a FROM customer_addresses WHERE customer_id = cu.id ORDER BY (type = 'MAIN') DESC LIMIT 1;
  SELECT data INTO cap FROM or_client_captures WHERE repair_order_id = _or AND status = 'pending' ORDER BY created_at DESC LIMIT 1;
  cap := coalesce(cap, '{}'::jsonb);
  SELECT id INTO _cli FROM clients
    WHERE ltrim(coalesce(account_number,''),'0') = ltrim(coalesce(cu.source_customer_id,''),'0') AND coalesce(cu.source_customer_id,'') <> ''
      AND norm_contact(last_name) = norm_contact(_ln) AND NOT public.is_internal_client(id, ro.site_id)
    ORDER BY created_at LIMIT 1;
  IF _cli IS NULL THEN
    INSERT INTO clients (account_number, last_name, first_name, address, postal_code, city, phone, mobile, email)
    VALUES (cu.source_customer_id, _ln, _fn, a.address_line_1, a.postal_code, a.city, tel, mob, lower(mail))
    RETURNING id INTO _cli;
  END IF;
  FOREACH k IN ARRAY ARRAY['address','address_extra','postal_code','city','phone','mobile','email'] LOOP
    rd := nullif(btrim(coalesce(cap->>k,'')),'');
    IF rd IS NULL OR (k IN ('phone','mobile') AND public.is_garage_contact('phone', rd, ro.site_id)) OR (k = 'email' AND public.is_garage_contact('email', rd, ro.site_id)) THEN CONTINUE; END IF;
    EXECUTE format('SELECT %I FROM clients WHERE id = $1', k) INTO cur USING _cli;
    IF coalesce(cur,'') = '' THEN EXECUTE format('UPDATE clients SET %I = $1 WHERE id = $2', k) USING rd, _cli; END IF;
  END LOOP;
  _old := ro.client_id;
  UPDATE repair_orders SET client_id = _cli WHERE id = _or;
  SELECT * INTO veh FROM vehicles WHERE id = ro.vehicle_id;
  IF veh.id IS NOT NULL AND (veh.client_id IS NULL OR veh.client_id = _old OR public.is_internal_client(veh.client_id, ro.site_id)) THEN
    UPDATE vehicles SET client_id = _cli WHERE id = veh.id;
  END IF;
  UPDATE or_client_captures SET status = 'validated', resolved_client_id = _cli, resolved_customer_id = cu.id,
    resolved_by = _uid, resolved_by_name = _user_name, resolved_at = now()
    WHERE repair_order_id = _or AND status = 'pending';
  INSERT INTO or_client_captures (repair_order_id, site_id, data, reason, status, resolved_client_id, resolved_customer_id, created_by, created_by_name, resolved_by, resolved_by_name, resolved_at)
  VALUES (_or, ro.site_id, jsonb_build_object('previous_client_id', _old), 'rattachement_referentiel', 'validated', _cli, cu.id, _uid, _user_name, _uid, _user_name, now());
  RETURN jsonb_build_object('client_id', _cli, 'previous_client_id', _old);
END $$;

CREATE OR REPLACE FUNCTION public.create_or_client_from_capture(_capture uuid, _last_name text, _first_name text DEFAULT NULL, _user_name text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); cp record; ro record; veh record; c jsonb; _cli uuid; _old uuid; _ln text := nullif(btrim(coalesce(_last_name,'')),'');
BEGIN
  IF _uid IS NULL OR NOT public.is_active_user(_uid) THEN RAISE EXCEPTION 'not allowed'; END IF;
  SELECT * INTO cp FROM or_client_captures WHERE id = _capture AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'capture not found'; END IF;
  SELECT * INTO ro FROM repair_orders WHERE id = cp.repair_order_id FOR UPDATE;
  IF ro.site_id IS NULL OR NOT public.user_can_access_site(_uid, ro.site_id) THEN RAISE EXCEPTION 'site not allowed'; END IF;
  IF _ln IS NULL OR public.is_garage_contact('name', concat_ws(' ', _ln, _first_name), ro.site_id) THEN RAISE EXCEPTION 'invalid_name'; END IF;
  c := cp.data;
  INSERT INTO clients (account_number, last_name, first_name, address, address_extra, postal_code, city, phone, mobile, email)
  VALUES (nullif(btrim(coalesce(c->>'account_number','')),''), _ln, nullif(btrim(coalesce(_first_name, c->>'first_name','')),''),
    nullif(btrim(coalesce(c->>'address','')),''), nullif(btrim(coalesce(c->>'address_extra','')),''),
    nullif(btrim(coalesce(c->>'postal_code','')),''), nullif(btrim(coalesce(c->>'city','')),''),
    nullif(btrim(coalesce(c->>'phone','')),''), nullif(btrim(coalesce(c->>'mobile','')),''), nullif(lower(btrim(coalesce(c->>'email',''))),''))
  RETURNING id INTO _cli;
  _old := ro.client_id;
  UPDATE repair_orders SET client_id = _cli WHERE id = ro.id;
  SELECT * INTO veh FROM vehicles WHERE id = ro.vehicle_id;
  IF veh.id IS NOT NULL AND (veh.client_id IS NULL OR veh.client_id = _old OR public.is_internal_client(veh.client_id, ro.site_id)) THEN
    UPDATE vehicles SET client_id = _cli WHERE id = veh.id;
  END IF;
  UPDATE or_client_captures SET status = 'validated', resolved_client_id = _cli, resolved_by = _uid, resolved_by_name = _user_name, resolved_at = now() WHERE id = _capture;
  RETURN jsonb_build_object('client_id', _cli, 'previous_client_id', _old);
END $$;

CREATE OR REPLACE FUNCTION public.dismiss_or_client_capture(_capture uuid, _user_name text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); cp record;
BEGIN
  IF _uid IS NULL OR NOT public.is_active_user(_uid) THEN RAISE EXCEPTION 'not allowed'; END IF;
  SELECT * INTO cp FROM or_client_captures WHERE id = _capture AND status = 'pending';
  IF NOT FOUND THEN RETURN; END IF;
  IF cp.site_id IS NULL OR NOT public.user_can_access_site(_uid, cp.site_id) THEN RAISE EXCEPTION 'site not allowed'; END IF;
  UPDATE or_client_captures SET status = 'dismissed', resolved_by = _uid, resolved_by_name = _user_name, resolved_at = now() WHERE id = _capture;
END $$;

CREATE OR REPLACE FUNCTION public.list_suspect_or_clients(_site uuid, _limit int DEFAULT 100)
RETURNS TABLE (or_id uuid, or_number text, plate text, client_name text, reasons text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT public.is_active_user(_uid) OR _site IS NULL OR NOT public.user_can_access_site(_uid, _site) THEN RAISE EXCEPTION 'not allowed'; END IF;
  RETURN QUERY
  SELECT q.id, q.or_number, q.plate, q.client_name, q.reasons FROM (
    SELECT r.id, r.or_number, v.plate, concat_ws(' ', c.first_name, c.last_name) AS client_name, r.created_at,
      array_remove(ARRAY[
        CASE WHEN c.id IS NOT NULL AND (public.is_garage_contact('name', c.last_name, _site) OR public.is_garage_contact('name', c.first_name, _site)
          OR public.is_garage_contact('name', concat_ws(' ', c.last_name, c.first_name), _site)) THEN 'nom_garage' END,
        CASE WHEN c.id IS NOT NULL AND (public.is_garage_contact('phone', c.phone, _site) OR public.is_garage_contact('phone', c.mobile, _site)) THEN 'telephone_garage' END,
        CASE WHEN coalesce(c.address,'') ~ '^\s*\d{1,2}[/.-]\d{1,2}[/.-]\d{1,4}\s' THEN 'adresse_date' END,
        CASE WHEN c.first_name IS NOT NULL AND public.name_tokens(c.first_name) <> '{}' AND public.name_tokens(c.last_name) @> public.name_tokens(c.first_name)
          AND cardinality(public.name_tokens(c.last_name)) > cardinality(public.name_tokens(c.first_name)) THEN 'prenom_double' END,
        CASE WHEN r.client_id IS NULL AND EXISTS (SELECT 1 FROM or_client_captures k WHERE k.repair_order_id = r.id AND k.status = 'pending') THEN 'client_absent' END
      ]::text[], NULL) AS reasons
    FROM repair_orders r
    LEFT JOIN clients c ON c.id = r.client_id
    LEFT JOIN vehicles v ON v.id = r.vehicle_id
    WHERE r.site_id = _site AND r.record_type = 'or_winmotor'
  ) q WHERE cardinality(q.reasons) > 0
  ORDER BY q.created_at DESC LIMIT greatest(1, least(coalesce(_limit, 100), 500));
END $$;

REVOKE ALL ON FUNCTION public.or_client_candidates(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.link_or_client_from_referential(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_or_client_from_capture(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dismiss_or_client_capture(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_suspect_or_clients(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.or_client_candidates(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_or_client_from_referential(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_or_client_from_capture(uuid, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dismiss_or_client_capture(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_suspect_or_clients(uuid, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.name_tokens(text) TO authenticated, service_role;