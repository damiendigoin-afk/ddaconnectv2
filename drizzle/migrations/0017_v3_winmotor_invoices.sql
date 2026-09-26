-- V3 Phase C1 : import factures WinMotor (entêtes + détail), historique, rapprochement, sortie définitive stock.
CREATE TABLE public.winmotor_vat_codes (
  code text PRIMARY KEY,
  rate numeric NOT NULL,
  label text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.winmotor_vat_codes (code, rate, label) VALUES ('0', 0, 'Exonéré'), ('2', 20, 'TVA 20 %'), ('8', 20, 'TVA 20 %');

CREATE TABLE public.winmotor_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id),
  import_type text NOT NULL CHECK (import_type IN ('headers','details')),
  file_name text NOT NULL,
  file_hash text NOT NULL,
  file_size bigint,
  storage_path text,
  encoding text,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed')),
  date_min date,
  date_max date,
  rows_total integer NOT NULL DEFAULT 0,
  rows_rejected integer NOT NULL DEFAULT 0,
  rows_recovered integer NOT NULL DEFAULT 0,
  invoices_seen integer NOT NULL DEFAULT 0,
  invoices_created integer NOT NULL DEFAULT 0,
  invoices_updated integer NOT NULL DEFAULT 0,
  invoices_unchanged integer NOT NULL DEFAULT 0,
  lines_inserted integer NOT NULL DEFAULT 0,
  report jsonb,
  created_by uuid DEFAULT auth.uid(),
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (site_id, import_type, file_hash)
);

CREATE TABLE public.winmotor_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id),
  invoice_number text NOT NULL,
  doc_kind text NOT NULL DEFAULT 'invoice' CHECK (doc_kind IN ('invoice','credit','preinvoice')),
  invoice_date date,
  or_number text,
  repair_order_id uuid REFERENCES public.repair_orders(id),
  client_no text,
  client_name text,
  billed_client_no text,
  billed_client_name text,
  customer_id uuid REFERENCES public.customers(id),
  billed_customer_id uuid REFERENCES public.customers(id),
  plate text,
  plate_normalized text,
  vin text,
  vin_normalized text,
  ref_vehicle_id uuid REFERENCES public.ref_vehicles(id),
  total_ht numeric,
  total_tva numeric,
  total_ttc numeric,
  lines_net_ht numeric,
  lines_hours numeric,
  seller text,
  has_header boolean NOT NULL DEFAULT false,
  has_detail boolean NOT NULL DEFAULT false,
  header_hash text,
  lines_hash text,
  lines_version integer NOT NULL DEFAULT 0,
  header_raw jsonb,
  header_batch_id uuid REFERENCES public.winmotor_import_batches(id),
  detail_batch_id uuid REFERENCES public.winmotor_import_batches(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, invoice_number)
);
CREATE INDEX ON public.winmotor_invoices (site_id, or_number);
CREATE INDEX ON public.winmotor_invoices (repair_order_id);
CREATE INDEX ON public.winmotor_invoices (ref_vehicle_id, invoice_date DESC);
CREATE INDEX ON public.winmotor_invoices (customer_id, invoice_date DESC);
CREATE INDEX ON public.winmotor_invoices (billed_customer_id);
CREATE INDEX ON public.winmotor_invoices (plate_normalized);
CREATE INDEX ON public.winmotor_invoices (vin_normalized);
CREATE INDEX ON public.winmotor_invoices (invoice_date DESC);
CREATE INDEX ON public.winmotor_invoices (invoice_number);

CREATE TABLE public.winmotor_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.winmotor_invoices(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id),
  version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  source_seq integer,
  activity text,
  line_type text,
  line_kind text NOT NULL DEFAULT 'other' CHECK (line_kind IN ('package_header','part','package_part','labour','package_labour','other')),
  counts_revenue boolean NOT NULL DEFAULT true,
  counts_hours boolean NOT NULL DEFAULT false,
  reference text,
  reference_normalized text,
  designation text,
  qty numeric,
  unit_price_ht numeric,
  discount_pct numeric,
  net_ht numeric,
  vat_code text,
  vat_rate numeric,
  family text,
  extra jsonb,
  batch_id uuid REFERENCES public.winmotor_import_batches(id),
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Aucune contrainte d'unicité sur le contenu : deux lignes identiques légitimes restent deux lignes.
CREATE INDEX ON public.winmotor_invoice_lines (invoice_id) WHERE active;
CREATE INDEX ON public.winmotor_invoice_lines (reference_normalized) WHERE active;

CREATE TABLE public.winmotor_import_rejects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.winmotor_import_batches(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id),
  line_no integer,
  reason text NOT NULL,
  raw_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.winmotor_import_rejects (batch_id);

CREATE TABLE public.winmotor_reconciliation_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id),
  invoice_line_id uuid NOT NULL REFERENCES public.winmotor_invoice_lines(id),
  usage_id uuid REFERENCES public.or_part_usage(id),
  article_id uuid REFERENCES public.stock_articles(id),
  link_kind text NOT NULL DEFAULT 'or_usage' CHECK (link_kind IN ('or_usage','store_sale')),
  qty numeric NOT NULL CHECK (qty > 0),
  method text NOT NULL DEFAULT 'manual' CHECK (method IN ('auto','manual')),
  rule text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','stale','cancelled')),
  sale_movement_id uuid REFERENCES public.stock_movements(id),
  created_by uuid DEFAULT auth.uid(),
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by_name text
);
CREATE INDEX ON public.winmotor_reconciliation_links (invoice_line_id) WHERE status = 'active';
CREATE INDEX ON public.winmotor_reconciliation_links (usage_id) WHERE status = 'active';

CREATE TABLE public.winmotor_ref_equivalences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wm_ref_normalized text NOT NULL,
  dda_ref_normalized text NOT NULL,
  origin text NOT NULL DEFAULT 'user',
  confirmations integer NOT NULL DEFAULT 1,
  created_by uuid DEFAULT auth.uid(),
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wm_ref_normalized, dda_ref_normalized)
);

-- Sortie définitive : un mouvement au plus par lien de rapprochement (+ annulation distincte).
ALTER TABLE public.stock_movements ADD COLUMN reconciliation_link_id uuid REFERENCES public.winmotor_reconciliation_links(id);
ALTER TABLE public.stock_movements ADD COLUMN is_reversal boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX uq_stock_movements_link ON public.stock_movements (reconciliation_link_id, is_reversal) WHERE reconciliation_link_id IS NOT NULL;

CREATE TRIGGER trg_wm_invoices_upd BEFORE UPDATE ON public.winmotor_invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- GRANTs
GRANT SELECT ON public.winmotor_vat_codes, public.winmotor_import_batches, public.winmotor_invoices, public.winmotor_invoice_lines,
  public.winmotor_import_rejects, public.winmotor_reconciliation_links, public.winmotor_ref_equivalences TO authenticated;
GRANT INSERT, UPDATE ON public.winmotor_import_batches TO authenticated;
GRANT INSERT ON public.winmotor_import_rejects TO authenticated;
GRANT INSERT, UPDATE ON public.winmotor_ref_equivalences TO authenticated;
GRANT UPDATE ON public.winmotor_vat_codes TO authenticated;
GRANT ALL ON public.winmotor_vat_codes, public.winmotor_import_batches, public.winmotor_invoices, public.winmotor_invoice_lines,
  public.winmotor_import_rejects, public.winmotor_reconciliation_links, public.winmotor_ref_equivalences TO service_role;

ALTER TABLE public.winmotor_vat_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.winmotor_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.winmotor_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.winmotor_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.winmotor_import_rejects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.winmotor_reconciliation_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.winmotor_ref_equivalences ENABLE ROW LEVEL SECURITY;

CREATE POLICY wmv_read ON public.winmotor_vat_codes FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY wmv_upd ON public.winmotor_vat_codes FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'manager')) WITH CHECK (public.has_role(auth.uid(),'manager'));
CREATE POLICY wmb_read ON public.winmotor_import_batches FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY wmb_ins ON public.winmotor_import_batches FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), site_id));
CREATE POLICY wmb_upd ON public.winmotor_import_batches FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), site_id)) WITH CHECK (public.user_can_access_site(auth.uid(), site_id));
CREATE POLICY wmi_read ON public.winmotor_invoices FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY wml_read ON public.winmotor_invoice_lines FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY wmr_read ON public.winmotor_import_rejects FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY wmr_ins ON public.winmotor_import_rejects FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), site_id));
CREATE POLICY wmk_read ON public.winmotor_reconciliation_links FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY wme_read ON public.winmotor_ref_equivalences FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY wme_ins ON public.winmotor_ref_equivalences FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY wme_upd ON public.winmotor_ref_equivalences FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));

-- Garde d'import : compte actif + accès au site + (manager ou menu Paramétrage).
CREATE OR REPLACE FUNCTION public.wm_can_import(_site uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), _site)
    AND (public.has_role(auth.uid(),'manager') OR EXISTS (
      SELECT 1 FROM public.user_module_access a WHERE a.user_id = auth.uid() AND a.allowed AND a.module_key IN ('parametrage','base')));
$$;

-- Entêtes : upsert facture + client (dossier et facturé distincts) + véhicule + contacts, sans écraser des valeurs plus récentes.
CREATE OR REPLACE FUNCTION public.wm_import_headers(_batch uuid, _site uuid, _rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r jsonb; v_inv public.winmotor_invoices; v_cust uuid; v_billed uuid; v_veh uuid; v_or uuid;
  v_created int := 0; v_updated int := 0; v_same int := 0;
  v_ct text; v_val text; v_norm text; v_known date;
BEGIN
  IF NOT public.wm_can_import(_site) THEN RAISE EXCEPTION 'Import non autorisé pour ce site'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    v_cust := NULL; v_billed := NULL; v_veh := NULL; v_or := NULL;
    v_known := NULLIF(r->>'last_visit','')::date;

    -- Client du dossier
    IF COALESCE(r->>'client_no','') <> '' THEN
      SELECT id INTO v_cust FROM public.customers WHERE site_id = _site AND source_system = 'winmotor' AND source_customer_id = r->>'client_no';
      IF v_cust IS NULL THEN
        INSERT INTO public.customers (site_id, source_system, source_customer_id, customer_type, last_name, first_name, last_name_normalized, first_name_normalized)
        VALUES (_site, 'winmotor', r->>'client_no', 'PARTICULIER', NULLIF(r->>'client_last',''), NULLIF(r->>'client_first',''),
          NULLIF(upper(regexp_replace(unaccent(COALESCE(r->>'client_last','')), '[^A-Za-z0-9]', '', 'g')),''),
          NULLIF(upper(regexp_replace(unaccent(COALESCE(r->>'client_first','')), '[^A-Za-z0-9]', '', 'g')),''))
        RETURNING id INTO v_cust;
      END IF;
      -- Contacts : ajout seulement (historique/provenance conservés, jamais d'écrasement).
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
    -- Client facturé (relation distincte)
    IF COALESCE(r->>'billed_no','') <> '' THEN
      IF r->>'billed_no' = r->>'client_no' THEN v_billed := v_cust;
      ELSE
        SELECT id INTO v_billed FROM public.customers WHERE site_id = _site AND source_system = 'winmotor' AND source_customer_id = r->>'billed_no';
        IF v_billed IS NULL THEN
          INSERT INTO public.customers (site_id, source_system, source_customer_id, customer_type, last_name, last_name_normalized)
          VALUES (_site, 'winmotor', r->>'billed_no', 'PARTICULIER', NULLIF(r->>'billed_name',''),
            NULLIF(upper(regexp_replace(unaccent(COALESCE(r->>'billed_name','')), '[^A-Za-z0-9]', '', 'g')),''))
          RETURNING id INTO v_billed;
        END IF;
      END IF;
    END IF;

    -- Véhicule : VIN fort ; plaque seule uniquement si le VIN existant est vide ou identique.
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
      -- Dernier km connu : uniquement « dernier connu », jamais attribué aux anciennes interventions.
      UPDATE public.ref_vehicles SET
        last_mileage = CASE WHEN NULLIF(r->>'last_km','')::int IS NOT NULL AND (last_mileage IS NULL OR (v_known IS NOT NULL AND (last_mileage_at IS NULL OR v_known > last_mileage_at::date))) THEN (r->>'last_km')::int ELSE last_mileage END,
        last_mileage_at = CASE WHEN NULLIF(r->>'last_km','')::int IS NOT NULL AND (last_mileage IS NULL OR (v_known IS NOT NULL AND (last_mileage_at IS NULL OR v_known > last_mileage_at::date))) THEN v_known ELSE last_mileage_at END,
        last_visit_at = CASE WHEN v_known IS NOT NULL AND (last_visit_at IS NULL OR v_known > last_visit_at::date) THEN v_known ELSE last_visit_at END,
        brand = COALESCE(brand, NULLIF(r->>'brand','')), model = COALESCE(model, NULLIF(r->>'model','')),
        vin = COALESCE(vin, NULLIF(r->>'vin','')), vin_normalized = COALESCE(vin_normalized, NULLIF(r->>'vin_n',''))
      WHERE id = v_veh;
      IF v_cust IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customer_vehicle_relations WHERE vehicle_id = v_veh AND active AND relationship_type = 'OWNER') THEN
        INSERT INTO public.customer_vehicle_relations (customer_id, vehicle_id, relationship_type, active, source) VALUES (v_cust, v_veh, 'OWNER', true, 'winmotor_factures');
      END IF;
    END IF;

    IF COALESCE(r->>'or','') <> '' THEN
      SELECT id INTO v_or FROM public.repair_orders WHERE or_number = r->>'or' AND (site_id = _site OR site_id IS NULL) ORDER BY (site_id = _site) DESC NULLS LAST LIMIT 1;
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
END $$;

-- Détail : par facture, remplace l'ensemble de lignes actif seulement si son contenu a changé (versionné, traçable).
CREATE OR REPLACE FUNCTION public.wm_import_details(_batch uuid, _site uuid, _invoices jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  i jsonb; v_inv public.winmotor_invoices; v_id uuid; v_ver int; v_or uuid;
  v_created int := 0; v_updated int := 0; v_same int := 0; v_lines int := 0; v_n int;
BEGIN
  IF NOT public.wm_can_import(_site) THEN RAISE EXCEPTION 'Import non autorisé pour ce site'; END IF;
  FOR i IN SELECT * FROM jsonb_array_elements(_invoices) LOOP
    SELECT * INTO v_inv FROM public.winmotor_invoices WHERE site_id = _site AND invoice_number = i->>'inv' FOR UPDATE;
    IF v_inv.id IS NOT NULL AND v_inv.has_detail AND v_inv.lines_hash = i->>'lines_hash' THEN
      v_same := v_same + 1; CONTINUE;
    END IF;
    v_or := NULL;
    IF COALESCE(i->>'or','') <> '' THEN
      SELECT id INTO v_or FROM public.repair_orders WHERE or_number = i->>'or' AND (site_id = _site OR site_id IS NULL) ORDER BY (site_id = _site) DESC NULLS LAST LIMIT 1;
    END IF;
    IF v_inv.id IS NULL THEN
      -- Détail arrivé avant l'entête : facture « incomplète » enrichie plus tard.
      INSERT INTO public.winmotor_invoices (site_id, invoice_number, doc_kind, invoice_date, or_number, repair_order_id, client_no, client_name, billed_client_no, billed_client_name, plate, plate_normalized, vin, vin_normalized, has_header, detail_batch_id)
      VALUES (_site, i->>'inv', COALESCE(i->>'doc_kind','invoice'), NULLIF(i->>'date','')::date, NULLIF(i->>'or',''), v_or, NULLIF(i->>'client_no',''), NULLIF(i->>'client_name',''), NULLIF(i->>'billed_no',''), NULLIF(i->>'billed_name',''), NULLIF(i->>'plate',''), NULLIF(i->>'plate_n',''), NULLIF(i->>'vin',''), NULLIF(i->>'vin_n',''), false, _batch)
      RETURNING id INTO v_id;
      v_ver := 1; v_created := v_created + 1;
    ELSE
      v_id := v_inv.id; v_ver := v_inv.lines_version + 1;
      IF v_inv.has_detail THEN
        UPDATE public.winmotor_invoice_lines SET active = false, superseded_at = now() WHERE invoice_id = v_id AND active;
        -- Rapprochements des anciennes lignes : à revoir (aucun mouvement de stock annulé automatiquement).
        UPDATE public.winmotor_reconciliation_links SET status = 'stale' WHERE status = 'active' AND invoice_line_id IN (SELECT id FROM public.winmotor_invoice_lines WHERE invoice_id = v_id AND NOT active);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n > 0 THEN
          INSERT INTO public.parts_regularizations (site_id, kind, source_table, source_id, repair_order_id, comment)
          VALUES (_site, 'rapprochement_a_revoir', 'winmotor_invoices', v_id, COALESCE(v_inv.repair_order_id, v_or), 'Facture ' || (i->>'inv') || ' modifiée dans un export plus récent : ' || v_n || ' rapprochement(s) à revoir');
        END IF;
        v_updated := v_updated + 1;
      ELSE
        v_created := v_created + 1;
      END IF;
    END IF;
    INSERT INTO public.winmotor_invoice_lines (invoice_id, site_id, version, source_seq, activity, line_type, line_kind, counts_revenue, counts_hours, reference, reference_normalized, designation, qty, unit_price_ht, discount_pct, net_ht, vat_code, vat_rate, family, extra, batch_id)
    SELECT v_id, _site, v_ver, (l->>'seq')::int, NULLIF(l->>'activity',''), NULLIF(l->>'line_type',''), l->>'kind', (l->>'rev')::boolean, (l->>'hours')::boolean, NULLIF(l->>'ref',''), NULLIF(l->>'ref_n',''), NULLIF(l->>'designation',''),
      NULLIF(l->>'qty','')::numeric, NULLIF(l->>'unit','')::numeric, NULLIF(l->>'discount','')::numeric, NULLIF(l->>'net','')::numeric, NULLIF(l->>'vat_code',''), NULLIF(l->>'vat_rate','')::numeric, NULLIF(l->>'family',''), l->'extra', _batch
    FROM jsonb_array_elements(i->'lines') l;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_lines := v_lines + v_n;
    UPDATE public.winmotor_invoices SET has_detail = true, lines_hash = i->>'lines_hash', lines_version = v_ver, detail_batch_id = _batch,
      lines_net_ht = NULLIF(i->>'net_ht','')::numeric, lines_hours = NULLIF(i->>'hours','')::numeric,
      repair_order_id = COALESCE(repair_order_id, v_or), or_number = COALESCE(or_number, NULLIF(i->>'or','')),
      invoice_date = COALESCE(invoice_date, NULLIF(i->>'date','')::date), doc_kind = CASE WHEN has_header THEN doc_kind ELSE COALESCE(i->>'doc_kind', doc_kind) END,
      billed_client_no = COALESCE(billed_client_no, NULLIF(i->>'billed_no','')), billed_client_name = COALESCE(billed_client_name, NULLIF(i->>'billed_name','')),
      client_no = COALESCE(client_no, NULLIF(i->>'client_no','')), client_name = COALESCE(client_name, NULLIF(i->>'client_name','')),
      plate_normalized = COALESCE(plate_normalized, NULLIF(i->>'plate_n','')), plate = COALESCE(plate, NULLIF(i->>'plate','')),
      vin_normalized = COALESCE(vin_normalized, NULLIF(i->>'vin_n','')),
      ref_vehicle_id = COALESCE(ref_vehicle_id, (SELECT id FROM public.ref_vehicles rv WHERE rv.site_id = _site AND ((NULLIF(i->>'vin_n','') IS NOT NULL AND rv.vin_normalized = i->>'vin_n') OR (NULLIF(i->>'vin_n','') IS NULL AND rv.registration_normalized = NULLIF(i->>'plate_n',''))) ORDER BY rv.updated_at DESC LIMIT 1)),
      customer_id = COALESCE(customer_id, (SELECT id FROM public.customers c WHERE c.site_id = _site AND c.source_system = 'winmotor' AND c.source_customer_id = NULLIF(i->>'client_no',''))),
      billed_customer_id = COALESCE(billed_customer_id, (SELECT id FROM public.customers c WHERE c.site_id = _site AND c.source_system = 'winmotor' AND c.source_customer_id = NULLIF(i->>'billed_no','')))
    WHERE id = v_id;
  END LOOP;
  RETURN jsonb_build_object('created', v_created, 'updated', v_updated, 'unchanged', v_same, 'lines', v_lines);
END $$;

-- Rattache les factures aux OR existants (site + n° OR) et crée le miroir des OR WinMotor récents manquants.
CREATE OR REPLACE FUNCTION public.wm_link_orders(_site uuid, _mirror_since date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_veh uuid; v_or uuid; v_linked int := 0; v_mirrored int := 0;
BEGIN
  IF NOT public.wm_can_import(_site) THEN RAISE EXCEPTION 'Non autorisé'; END IF;
  UPDATE public.winmotor_invoices w SET repair_order_id = ro.id
    FROM public.repair_orders ro
   WHERE w.site_id = _site AND w.repair_order_id IS NULL AND w.or_number IS NOT NULL AND ro.or_number = w.or_number AND ro.site_id = _site;
  GET DIAGNOSTICS v_linked = ROW_COUNT;
  FOR r IN SELECT DISTINCT ON (or_number) or_number, invoice_date, plate, plate_normalized, vin, vin_normalized, ref_vehicle_id
             FROM public.winmotor_invoices WHERE site_id = _site AND repair_order_id IS NULL AND or_number IS NOT NULL AND invoice_date >= _mirror_since AND plate_normalized IS NOT NULL
             ORDER BY or_number, invoice_date LOOP
    SELECT id INTO v_veh FROM public.vehicles WHERE plate_normalized = r.plate_normalized LIMIT 1;
    IF v_veh IS NULL THEN
      INSERT INTO public.vehicles (plate, plate_normalized, vin, brand, model)
      SELECT COALESCE(r.plate, r.plate_normalized), r.plate_normalized, r.vin, rv.brand, rv.model FROM (SELECT 1) x LEFT JOIN public.ref_vehicles rv ON rv.id = r.ref_vehicle_id
      RETURNING id INTO v_veh;
    END IF;
    INSERT INTO public.repair_orders (vehicle_id, or_number, or_date, site_id, record_type, or_status, or_source, or_linked_at, status, created_by_name)
    VALUES (v_veh, r.or_number, r.invoice_date, _site, 'or_winmotor', 'or_complet', 'winmotor_import', now(), 'closed', 'Import WinMotor')
    RETURNING id INTO v_or;
    UPDATE public.winmotor_invoices SET repair_order_id = v_or WHERE site_id = _site AND or_number = r.or_number AND repair_order_id IS NULL;
    v_mirrored := v_mirrored + 1;
  END LOOP;
  RETURN jsonb_build_object('linked', v_linked, 'mirrored', v_mirrored);
END $$;

-- Rapprochement ligne WinMotor ↔ pièce DDA : contrôle des restants + sortie définitive unique.
CREATE OR REPLACE FUNCTION public.wm_link_usage(_line uuid, _usage uuid, _qty numeric, _method text, _rule text, _user_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; u record; v_line_left numeric; v_usage_left numeric; v_link uuid; v_mv uuid;
BEGIN
  SELECT wl.*, wi.doc_kind, wi.repair_order_id AS inv_or INTO l FROM public.winmotor_invoice_lines wl JOIN public.winmotor_invoices wi ON wi.id = wl.invoice_id WHERE wl.id = _line FOR UPDATE OF wl;
  IF l.id IS NULL OR NOT l.active THEN RAISE EXCEPTION 'Ligne de facture introuvable ou remplacée'; END IF;
  IF NOT (public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), l.site_id)) THEN RAISE EXCEPTION 'Non autorisé'; END IF;
  IF l.doc_kind = 'preinvoice' THEN RAISE EXCEPTION 'Une préfacture ne peut pas justifier une sortie définitive'; END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'Quantité invalide'; END IF;
  IF COALESCE(l.qty,0) <= 0 THEN RAISE EXCEPTION 'Ligne négative/avoir : utiliser le traitement des avoirs'; END IF;
  SELECT * INTO u FROM public.or_part_usage WHERE id = _usage FOR UPDATE;
  IF u.id IS NULL THEN RAISE EXCEPTION 'Pièce DDA introuvable'; END IF;
  IF u.site_id IS DISTINCT FROM l.site_id THEN RAISE EXCEPTION 'Site différent : rapprochement refusé'; END IF;
  IF l.inv_or IS DISTINCT FROM u.repair_order_id THEN RAISE EXCEPTION 'OR différent : rapprochement refusé'; END IF;
  SELECT l.qty - COALESCE(SUM(qty),0) INTO v_line_left FROM public.winmotor_reconciliation_links WHERE invoice_line_id = _line AND status = 'active';
  SELECT COALESCE(u.qty_used, u.qty_allocated) - COALESCE(SUM(qty),0) INTO v_usage_left FROM public.winmotor_reconciliation_links WHERE usage_id = _usage AND status = 'active';
  IF _qty > v_line_left OR _qty > v_usage_left THEN RAISE EXCEPTION 'Quantité supérieure au restant (facture % / DDA %)', v_line_left, v_usage_left; END IF;
  INSERT INTO public.winmotor_reconciliation_links (site_id, invoice_line_id, usage_id, article_id, link_kind, qty, method, rule, created_by_name)
  VALUES (l.site_id, _line, _usage, u.article_id, 'or_usage', _qty, COALESCE(_method,'manual'), _rule, _user_name) RETURNING id INTO v_link;
  -- Sortie définitive : seulement si la pièce est suivie en stock et affectée à l'OR. allocated − qty, available inchangé.
  IF u.article_id IS NOT NULL AND u.qty_allocated > 0 THEN
    INSERT INTO public.stock_movements (site_id, article_id, movement_type, qty, delta_available, delta_allocated, delta_quarantine, repair_order_id, reason, created_by_name, reconciliation_link_id)
    VALUES (l.site_id, u.article_id, 'or_sale_final', LEAST(_qty, u.qty_allocated), 0, -LEAST(_qty, u.qty_allocated), 0, u.repair_order_id, 'Facturée WinMotor', _user_name, v_link)
    RETURNING id INTO v_mv;
    UPDATE public.winmotor_reconciliation_links SET sale_movement_id = v_mv WHERE id = v_link;
  END IF;
  RETURN v_link;
END $$;

CREATE OR REPLACE FUNCTION public.wm_unlink(_link uuid, _user_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k record; m record;
BEGIN
  SELECT * INTO k FROM public.winmotor_reconciliation_links WHERE id = _link FOR UPDATE;
  IF k.id IS NULL OR k.status = 'cancelled' THEN RETURN; END IF;
  IF NOT (public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), k.site_id)) THEN RAISE EXCEPTION 'Non autorisé'; END IF;
  UPDATE public.winmotor_reconciliation_links SET status = 'cancelled', cancelled_at = now(), cancelled_by_name = _user_name WHERE id = _link;
  IF k.sale_movement_id IS NOT NULL THEN
    SELECT * INTO m FROM public.stock_movements WHERE id = k.sale_movement_id;
    -- Contre-passation unique : la pièce redevient « affectée OR » (pas de retour stock automatique).
    INSERT INTO public.stock_movements (site_id, article_id, movement_type, qty, delta_available, delta_allocated, delta_quarantine, repair_order_id, reason, created_by_name, reconciliation_link_id, is_reversal)
    VALUES (m.site_id, m.article_id, m.movement_type, -m.qty, -m.delta_available, -m.delta_allocated, 0, m.repair_order_id, 'Annulation rapprochement', _user_name, _link, true);
  END IF;
END $$;

-- Vente magasin : sortie explicite, confirmée par un humain, rattachée à une ligne de facture.
CREATE OR REPLACE FUNCTION public.wm_store_sale(_line uuid, _article uuid, _qty numeric, _user_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; a record; v_left numeric; v_link uuid; v_mv uuid;
BEGIN
  SELECT wl.*, wi.doc_kind INTO l FROM public.winmotor_invoice_lines wl JOIN public.winmotor_invoices wi ON wi.id = wl.invoice_id WHERE wl.id = _line FOR UPDATE OF wl;
  IF l.id IS NULL OR NOT l.active THEN RAISE EXCEPTION 'Ligne introuvable'; END IF;
  IF NOT (public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), l.site_id)) THEN RAISE EXCEPTION 'Non autorisé'; END IF;
  IF l.doc_kind = 'preinvoice' THEN RAISE EXCEPTION 'Préfacture : sortie refusée'; END IF;
  SELECT * INTO a FROM public.stock_articles WHERE id = _article;
  IF a.site_id IS DISTINCT FROM l.site_id THEN RAISE EXCEPTION 'Site différent'; END IF;
  SELECT l.qty - COALESCE(SUM(qty),0) INTO v_left FROM public.winmotor_reconciliation_links WHERE invoice_line_id = _line AND status = 'active';
  IF _qty <= 0 OR _qty > v_left THEN RAISE EXCEPTION 'Quantité supérieure au restant (%)', v_left; END IF;
  INSERT INTO public.winmotor_reconciliation_links (site_id, invoice_line_id, article_id, link_kind, qty, method, rule, created_by_name)
  VALUES (l.site_id, _line, _article, 'store_sale', _qty, 'manual', 'vente_magasin', _user_name) RETURNING id INTO v_link;
  INSERT INTO public.stock_movements (site_id, article_id, movement_type, qty, delta_available, delta_allocated, delta_quarantine, reason, created_by_name, reconciliation_link_id)
  VALUES (l.site_id, _article, 'store_sale_final', _qty, -_qty, 0, 0, 'Vente magasin facturée WinMotor', _user_name, v_link) RETURNING id INTO v_mv;
  UPDATE public.winmotor_reconciliation_links SET sale_movement_id = v_mv WHERE id = v_link;
  RETURN v_link;
END $$;

REVOKE EXECUTE ON FUNCTION public.wm_import_headers(uuid,uuid,jsonb), public.wm_import_details(uuid,uuid,jsonb), public.wm_link_orders(uuid,date),
  public.wm_link_usage(uuid,uuid,numeric,text,text,text), public.wm_unlink(uuid,text), public.wm_store_sale(uuid,uuid,numeric,text), public.wm_can_import(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wm_import_headers(uuid,uuid,jsonb), public.wm_import_details(uuid,uuid,jsonb), public.wm_link_orders(uuid,date),
  public.wm_link_usage(uuid,uuid,numeric,text,text,text), public.wm_unlink(uuid,text), public.wm_store_sale(uuid,uuid,numeric,text), public.wm_can_import(uuid) TO authenticated;