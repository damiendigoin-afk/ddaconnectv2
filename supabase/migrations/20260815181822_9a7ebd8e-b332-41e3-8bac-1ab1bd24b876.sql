CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- sites enrichment
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- normalization helper
CREATE OR REPLACE FUNCTION public.norm_text(_v text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, extensions AS $$
  SELECT NULLIF(upper(regexp_replace(unaccent(coalesce(_v,'')), '[^A-Za-z0-9]', '', 'g')), '')
$$;

-- ============ IMPORTS ============
CREATE TABLE public.imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id),
  source_system text NOT NULL DEFAULT 'winmotor',
  file_name text NOT NULL,
  file_size bigint,
  status text NOT NULL DEFAULT 'analyzing',
  total_rows integer NOT NULL DEFAULT 0,
  total_columns integer NOT NULL DEFAULT 0,
  processed_rows integer NOT NULL DEFAULT 0,
  customers_created integer NOT NULL DEFAULT 0,
  customers_updated integer NOT NULL DEFAULT 0,
  vehicles_created integer NOT NULL DEFAULT 0,
  vehicles_updated integer NOT NULL DEFAULT 0,
  relations_created integer NOT NULL DEFAULT 0,
  contacts_imported integer NOT NULL DEFAULT 0,
  addresses_imported integer NOT NULL DEFAULT 0,
  mileages_imported integer NOT NULL DEFAULT 0,
  duplicates_avoided integer NOT NULL DEFAULT 0,
  anomalies integer NOT NULL DEFAULT 0,
  analysis jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.imports TO authenticated;
GRANT ALL ON public.imports TO service_role;
ALTER TABLE public.imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "imports_manager_all" ON public.imports FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'manager'));

CREATE TABLE public.import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.imports(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  source_vehicle_id text,
  source_customer_id text,
  raw_data jsonb NOT NULL,
  processing_status text NOT NULL DEFAULT 'pending',
  processing_errors text[],
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_rows TO authenticated;
GRANT ALL ON public.import_rows TO service_role;
ALTER TABLE public.import_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "import_rows_manager_all" ON public.import_rows FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'manager'));
CREATE INDEX idx_import_rows_import ON public.import_rows(import_id, row_number);
CREATE INDEX idx_import_rows_status ON public.import_rows(import_id, processing_status);

-- ============ CUSTOMERS ============
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id),
  source_system text NOT NULL DEFAULT 'winmotor',
  source_customer_id text,
  customer_type text NOT NULL DEFAULT 'individual',
  civility text,
  last_name text,
  first_name text,
  company_name text,
  siret text,
  siren text,
  vat_number text,
  last_name_normalized text,
  first_name_normalized text,
  company_normalized text,
  notes text,
  import_id uuid REFERENCES public.imports(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers_read" ON public.customers FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "customers_write" ON public.customers FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "customers_update" ON public.customers FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "customers_delete" ON public.customers FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'manager'));
CREATE UNIQUE INDEX uq_customers_source ON public.customers(site_id, source_system, source_customer_id) WHERE source_customer_id IS NOT NULL;
CREATE INDEX idx_customers_lastname ON public.customers(last_name_normalized);
CREATE INDEX idx_customers_firstname ON public.customers(first_name_normalized);
CREATE INDEX idx_customers_company ON public.customers(company_normalized);
CREATE INDEX idx_customers_lastname_trgm ON public.customers USING gin (last_name_normalized gin_trgm_ops);
CREATE INDEX idx_customers_company_trgm ON public.customers USING gin (company_normalized gin_trgm_ops);
CREATE INDEX idx_customers_site ON public.customers(site_id);

CREATE TABLE public.customer_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  type text NOT NULL,
  value text NOT NULL,
  normalized_value text,
  source text NOT NULL DEFAULT 'WINMOTOR',
  source_import_id uuid REFERENCES public.imports(id),
  is_primary boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_contacts TO authenticated;
GRANT ALL ON public.customer_contacts TO service_role;
ALTER TABLE public.customer_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contacts_all" ON public.customer_contacts FOR ALL TO authenticated
  USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));
CREATE UNIQUE INDEX uq_contacts_value ON public.customer_contacts(customer_id, type, normalized_value);
CREATE INDEX idx_contacts_normalized ON public.customer_contacts(normalized_value);
CREATE INDEX idx_contacts_customer ON public.customer_contacts(customer_id);

CREATE TABLE public.customer_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'MAIN',
  address_line_1 text,
  address_line_2 text,
  address_line_3 text,
  postal_code text,
  city text,
  country text,
  source text NOT NULL DEFAULT 'WINMOTOR',
  source_import_id uuid REFERENCES public.imports(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_addresses TO authenticated;
GRANT ALL ON public.customer_addresses TO service_role;
ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "addresses_all" ON public.customer_addresses FOR ALL TO authenticated
  USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));
CREATE INDEX idx_addresses_customer ON public.customer_addresses(customer_id);

CREATE TABLE public.customer_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  channel text NOT NULL,
  allowed boolean,
  raw_value text,
  source text NOT NULL DEFAULT 'WINMOTOR',
  source_import_id uuid REFERENCES public.imports(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_consents TO authenticated;
GRANT ALL ON public.customer_consents TO service_role;
ALTER TABLE public.customer_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "consents_manager" ON public.customer_consents FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'manager'));
CREATE UNIQUE INDEX uq_consents ON public.customer_consents(customer_id, channel);

-- ============ REF VEHICLES ============
CREATE TABLE public.ref_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id),
  source_system text NOT NULL DEFAULT 'winmotor',
  source_vehicle_id text,
  registration_display text,
  registration_normalized text,
  previous_registration text,
  vin text,
  vin_normalized text,
  brand text,
  range_name text,
  model text,
  version text,
  variant text,
  trim_level text,
  vehicle_type text,
  body_type text,
  color text,
  energy text,
  power_hp text,
  power_kw text,
  engine_size text,
  gearbox text,
  doors integer,
  seats integer,
  engine_code text,
  gearbox_code text,
  type_mine text,
  cnit text,
  d2_code text,
  tvv text,
  first_registration_date date,
  purchase_date date,
  delivery_date date,
  sale_date date,
  last_ct_date date,
  next_ct_date date,
  last_mileage integer,
  last_mileage_at timestamptz,
  last_visit_at timestamptz,
  next_service_at date,
  legacy_vehicle_id uuid REFERENCES public.vehicles(id),
  import_id uuid REFERENCES public.imports(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ref_vehicles TO authenticated;
GRANT ALL ON public.ref_vehicles TO service_role;
ALTER TABLE public.ref_vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "refveh_read" ON public.ref_vehicles FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "refveh_insert" ON public.ref_vehicles FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "refveh_update" ON public.ref_vehicles FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "refveh_delete" ON public.ref_vehicles FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'manager'));
CREATE UNIQUE INDEX uq_refveh_source ON public.ref_vehicles(site_id, source_system, source_vehicle_id) WHERE source_vehicle_id IS NOT NULL;
CREATE INDEX idx_refveh_reg ON public.ref_vehicles(registration_normalized);
CREATE INDEX idx_refveh_reg_trgm ON public.ref_vehicles USING gin (registration_normalized gin_trgm_ops);
CREATE INDEX idx_refveh_vin ON public.ref_vehicles(vin_normalized);
CREATE INDEX idx_refveh_vin_trgm ON public.ref_vehicles USING gin (vin_normalized gin_trgm_ops);
CREATE INDEX idx_refveh_site ON public.ref_vehicles(site_id);
CREATE INDEX idx_refveh_brand ON public.ref_vehicles(brand);

CREATE TABLE public.customer_vehicle_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.ref_vehicles(id) ON DELETE CASCADE,
  relationship_type text NOT NULL DEFAULT 'OWNER',
  start_date date,
  end_date date,
  active boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'WINMOTOR',
  import_id uuid REFERENCES public.imports(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_vehicle_relations TO authenticated;
GRANT ALL ON public.customer_vehicle_relations TO service_role;
ALTER TABLE public.customer_vehicle_relations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cvr_all" ON public.customer_vehicle_relations FOR ALL TO authenticated
  USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));
CREATE UNIQUE INDEX uq_cvr ON public.customer_vehicle_relations(customer_id, vehicle_id, relationship_type);
CREATE INDEX idx_cvr_vehicle ON public.customer_vehicle_relations(vehicle_id);
CREATE INDEX idx_cvr_customer ON public.customer_vehicle_relations(customer_id);

CREATE TABLE public.vehicle_mileage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.ref_vehicles(id) ON DELETE CASCADE,
  mileage integer NOT NULL,
  measured_at timestamptz,
  source text NOT NULL DEFAULT 'MANUAL',
  import_id uuid REFERENCES public.imports(id),
  inspection_id uuid REFERENCES public.vehicle_inspections(id) ON DELETE SET NULL,
  expertise_id uuid REFERENCES public.vehicle_expertises(id) ON DELETE SET NULL,
  media_id uuid REFERENCES public.media(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_mileage_history TO authenticated;
GRANT ALL ON public.vehicle_mileage_history TO service_role;
ALTER TABLE public.vehicle_mileage_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vmh_read" ON public.vehicle_mileage_history FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "vmh_insert" ON public.vehicle_mileage_history FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "vmh_manage" ON public.vehicle_mileage_history FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'manager'));
CREATE INDEX idx_vmh_vehicle ON public.vehicle_mileage_history(vehicle_id, measured_at DESC);
CREATE UNIQUE INDEX uq_vmh_import ON public.vehicle_mileage_history(vehicle_id, mileage, source) WHERE source = 'WINMOTOR_IMPORT';

CREATE TABLE public.field_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  field text NOT NULL,
  value text,
  source text NOT NULL,
  source_date timestamptz,
  import_id uuid REFERENCES public.imports(id),
  changed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.field_provenance TO authenticated;
GRANT ALL ON public.field_provenance TO service_role;
ALTER TABLE public.field_provenance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "provenance_read_manager" ON public.field_provenance FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'manager'));
CREATE POLICY "provenance_write" ON public.field_provenance FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "provenance_update" ON public.field_provenance FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));
CREATE UNIQUE INDEX uq_provenance ON public.field_provenance(entity_type, entity_id, field, source);
CREATE INDEX idx_provenance_entity ON public.field_provenance(entity_type, entity_id);

-- updated_at triggers
CREATE TRIGGER trg_imports_updated BEFORE UPDATE ON public.imports FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_contacts_updated BEFORE UPDATE ON public.customer_contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_addresses_updated BEFORE UPDATE ON public.customer_addresses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_consents_updated BEFORE UPDATE ON public.customer_consents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_refveh_updated BEFORE UPDATE ON public.ref_vehicles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_cvr_updated BEFORE UPDATE ON public.customer_vehicle_relations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_provenance_updated BEFORE UPDATE ON public.field_provenance FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();