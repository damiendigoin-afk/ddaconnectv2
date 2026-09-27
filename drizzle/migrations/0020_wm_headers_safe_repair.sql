CREATE OR REPLACE FUNCTION public.wm_import_headers(_batch uuid, _site uuid, _rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r jsonb; v_inv public.winmotor_invoices; v_cust uuid; v_billed uuid; v_veh uuid; v_or uuid;
  v_created int := 0; v_updated int := 0; v_same int := 0;
  v_ct text; v_val text; v_norm text; v_known date;
BEGIN
  IF NOT public.wm_can_import(_site) THEN RAISE EXCEPTION 'Import non autorisé pour ce site'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    v_cust := NULL; v_billed := NULL; v_veh := NULL; v_or := NULL;
    v_known := NULLIF(r->>'last_visit','')::date;

    IF COALESCE(r->>'client_no','') <> '' THEN
      SELECT id INTO v_cust FROM public.customers WHERE site_id = _site AND source_system = 'winmotor' AND source_customer_id = r->>'client_no';
      IF v_cust IS NULL THEN
        INSERT INTO public.customers (site_id, source_system, source_customer_id, customer_type, last_name, first_name, last_name_normalized, first_name_normalized)
        VALUES (_site, 'winmotor', r->>'client_no', 'individual', NULLIF(r->>'client_last',''), NULLIF(r->>'client_first',''),
          NULLIF(upper(regexp_replace(unaccent(COALESCE(r->>'client_last','')), '[^A-Za-z0-9]', '', 'g')),''),
          NULLIF(upper(regexp_replace(unaccent(COALESCE(r->>'client_first','')), '[^A-Za-z0-9]', '', 'g')),''))
        RETURNING id INTO v_cust;
      ELSE
        -- Réparation sûre de l'ancien mapping (« Nom et Prénom » rangé dans le prénom) :
        -- uniquement fiche WinMotor jamais modifiée depuis sa création, nom et société vides, prénom = valeur brute.
        IF COALESCE(r->>'client_last','') <> '' AND COALESCE(r->>'client_first','') = '' THEN
          UPDATE public.customers SET last_name = r->>'client_last', first_name = NULL,
            last_name_normalized = NULLIF(upper(regexp_replace(unaccent(r->>'client_last'), '[^A-Za-z0-9]', '', 'g')),''), first_name_normalized = NULL
          WHERE id = v_cust AND source_system = 'winmotor' AND last_name IS NULL AND company_name IS NULL
            AND first_name = r->>'client_last' AND updated_at <= created_at + interval '1 minute';
        END IF;
      END IF;
      FOREACH v_ct IN ARRAY ARRAY['PHONE','MOBILE','EMAIL'] LOOP
        v_val := CASE v_ct WHEN 'PHONE' THEN r->>'phone' WHEN 'MOBILE' THEN r->>'mobile' ELSE r->>'email' END;
        v_norm := CASE v_ct WHEN 'EMAIL' THEN r->>'email' WHEN 'PHONE' THEN r->>'phone_n' ELSE r->>'mobile_n' END;
        IF COALESCE(v_norm,'') <> '' THEN
          INSERT INTO public.customer_contacts (customer_id, type, value, normalized_value, source, is_primary, active)
          VALUES (v_cust, v_ct, v_val, v_norm, 'winmotor_factures', false, true)
          ON CONFLICT (customer_id, type, normalized_value) DO NOTHING;
        END IF;
      END LOOP;
    END IF;
    IF COALESCE(r->>'billed_no','') <> '' THEN
      IF r->>'billed_no' = r->>'client_no' THEN v_billed := v_cust;
      ELSE
        SELECT id INTO v_billed FROM public.customers WHERE site_id = _site AND source_system = 'winmotor' AND source_customer_id = r->>'billed_no';
        IF v_billed IS NULL THEN
          INSERT INTO public.customers (site_id, source_system, source_customer_id, customer_type, last_name, last_name_normalized)
          VALUES (_site, 'winmotor', r->>'billed_no', 'individual', NULLIF(r->>'billed_name',''),
            NULLIF(upper(regexp_replace(unaccent(COALESCE(r->>'billed_name','')), '[^A-Za-z0-9]', '', 'g')),''))
          RETURNING id INTO v_billed;
        END IF;
      END IF;
    END IF;

    IF COALESCE(r->>'vin_n','') <> '' THEN
      SELECT id INTO v_veh FROM public.ref_vehicles WHERE site_id = _site AND vin_normalized = r->>'vin_n' ORDER BY updated_at DESC LIMIT 1;
    END IF;
    IF v_veh IS NULL AND COALESCE(r->>'plate_n','') <> '' THEN
      SELECT id INTO v_veh FROM public.ref_vehicles WHERE site_id = _site AND registration_normalized = r->>'plate_n'
        AND (vin_normalized IS NULL OR COALESCE(r->>'vin_n','') = '' OR vin_normalized = r->>'vin_n') ORDER BY updated_at DESC LIMIT 1;
    END IF;
    IF v_veh IS NULL AND (COALESCE(r->>'plate_n','') <> '' OR COALESCE(r->>'vin_n','') <> '') THEN
      INSERT INTO public.ref_vehicles (site_id, source_system, registration_display, registration_normalized, vin, vin_normalized, brand, range_name, model, type_mine, first_registration_date)
      VALUES (_site, 'winmotor', NULLIF(r->>'plate',''), NULLIF(r->>'plate_n',''), NULLIF(r->>'vin',''), NULLIF(r->>'vin_n',''), NULLIF(r->>'brand',''), NULLIF(r->>'range',''), NULLIF(r->>'model',''), NULLIF(r->>'type_mine',''), NULLIF(r->>'mec','')::date)
      RETURNING id INTO v_veh;
    END IF;
    IF v_veh IS NOT NULL THEN
      -- Champs vides complétés depuis WinMotor ; une valeur existante n'est jamais remplacée.
      UPDATE public.ref_vehicles SET
        last_mileage = CASE WHEN NULLIF(r->>'last_km','')::int IS NOT NULL AND (last_mileage IS NULL OR (v_known IS NOT NULL AND (last_mileage_at IS NULL OR v_known > last_mileage_at::date))) THEN (r->>'last_km')::int ELSE last_mileage END,
        last_mileage_at = CASE WHEN NULLIF(r->>'last_km','')::int IS NOT NULL AND (last_mileage IS NULL OR (v_known IS NOT NULL AND (last_mileage_at IS NULL OR v_known > last_mileage_at::date))) THEN v_known ELSE last_mileage_at END,
        last_visit_at = CASE WHEN v_known IS NOT NULL AND (last_visit_at IS NULL OR v_known > last_visit_at::date) THEN v_known ELSE last_visit_at END,
        brand = COALESCE(brand, NULLIF(r->>'brand','')), range_name = COALESCE(range_name, NULLIF(r->>'range','')), type_mine = COALESCE(type_mine, NULLIF(r->>'type_mine','')), first_registration_date = COALESCE(first_registration_date, NULLIF(r->>'mec','')::date), model = COALESCE(model, NULLIF(r->>'model','')),
        vin = COALESCE(vin, NULLIF(r->>'vin','')), vin_normalized = COALESCE(vin_normalized, NULLIF(r->>'vin_n',''))
      WHERE id = v_veh;
      IF v_cust IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customer_vehicle_relations WHERE vehicle_id = v_veh AND active AND relationship_type = 'OWNER') THEN
        INSERT INTO public.customer_vehicle_relations (customer_id, vehicle_id, relationship_type, active, source) VALUES (v_cust, v_veh, 'OWNER', true, 'winmotor_factures');
      END IF;
    END IF;

    IF COALESCE(r->>'or','') <> '' THEN
      v_or := public.wm_find_or(_site, r->>'or');
    END IF;

    SELECT * INTO v_inv FROM public.winmotor_invoices WHERE site_id = _site AND invoice_number = r->>'inv';
    IF v_inv.id IS NULL THEN
      INSERT INTO public.winmotor_invoices (site_id, invoice_number, doc_kind, invoice_date, or_number, repair_order_id, client_no, client_name, billed_client_no, billed_client_name,
        customer_id, billed_customer_id, plate, plate_normalized, vin, vin_normalized, ref_vehicle_id, total_ht, total_tva, total_ttc, seller, has_header, header_hash, header_raw, header_batch_id)
      VALUES (_site, r->>'inv', COALESCE(r->>'doc_kind','invoice'), NULLIF(r->>'date','')::date, NULLIF(r->>'or',''), v_or, NULLIF(r->>'client_no',''), NULLIF(r->>'client_name',''), NULLIF(r->>'billed_no',''), NULLIF(r->>'billed_name',''),
        v_cust, v_billed, NULLIF(r->>'plate',''), NULLIF(r->>'plate_n',''), NULLIF(r->>'vin',''), NULLIF(r->>'vin_n',''), v_veh, NULLIF(r->>'total_ht','')::numeric, NULLIF(r->>'total_tva','')::numeric, NULLIF(r->>'total_ttc','')::numeric, NULLIF(r->>'seller',''), true, r->>'hash', r->'raw', _batch);
      v_created := v_created + 1;
    ELSIF v_inv.has_header AND v_inv.header_hash = r->>'hash' THEN
      v_same := v_same + 1;
    ELSE
      UPDATE public.winmotor_invoices SET doc_kind = COALESCE(r->>'doc_kind', doc_kind), invoice_date = COALESCE(NULLIF(r->>'date','')::date, invoice_date), or_number = COALESCE(NULLIF(r->>'or',''), or_number),
        repair_order_id = COALESCE(repair_order_id, v_or), client_no = COALESCE(NULLIF(r->>'client_no',''), client_no), client_name = COALESCE(NULLIF(r->>'client_name',''), client_name),
        billed_client_no = COALESCE(NULLIF(r->>'billed_no',''), billed_client_no), billed_client_name = COALESCE(NULLIF(r->>'billed_name',''), billed_client_name),
        customer_id = COALESCE(v_cust, customer_id), billed_customer_id = COALESCE(v_billed, billed_customer_id), plate = COALESCE(NULLIF(r->>'plate',''), plate), plate_normalized = COALESCE(NULLIF(r->>'plate_n',''), plate_normalized),
        vin = COALESCE(NULLIF(r->>'vin',''), vin), vin_normalized = COALESCE(NULLIF(r->>'vin_n',''), vin_normalized), ref_vehicle_id = COALESCE(v_veh, ref_vehicle_id),
        total_ht = NULLIF(r->>'total_ht','')::numeric, total_tva = NULLIF(r->>'total_tva','')::numeric, total_ttc = NULLIF(r->>'total_ttc','')::numeric, seller = COALESCE(NULLIF(r->>'seller',''), seller),
        has_header = true, header_hash = r->>'hash', header_raw = r->'raw', header_batch_id = _batch
      WHERE id = v_inv.id;
      v_updated := v_updated + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('created', v_created, 'updated', v_updated, 'unchanged', v_same);
END $function$;