
-- ============ REFERENTIELS ============
CREATE TABLE public.insurers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text, phone text, address text, notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.insurers TO authenticated;
GRANT ALL ON public.insurers TO service_role;
ALTER TABLE public.insurers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "insurers_read" ON public.insurers FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "insurers_write" ON public.insurers FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'manager'));
CREATE POLICY "insurers_update" ON public.insurers FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'manager'));
CREATE POLICY "insurers_delete" ON public.insurers FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'manager'));

CREATE TABLE public.expert_firms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text, ead_email text, phone text, address text, notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expert_firms TO authenticated;
GRANT ALL ON public.expert_firms TO service_role;
ALTER TABLE public.expert_firms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expert_firms_read" ON public.expert_firms FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "expert_firms_write" ON public.expert_firms FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'manager'));
CREATE POLICY "expert_firms_update" ON public.expert_firms FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'manager'));
CREATE POLICY "expert_firms_delete" ON public.expert_firms FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'manager'));

CREATE TABLE public.experts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid REFERENCES public.expert_firms(id) ON DELETE SET NULL,
  last_name text, first_name text,
  phone text, mobile text, email text, ead_email text, supplement_email text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.experts TO authenticated;
GRANT ALL ON public.experts TO service_role;
ALTER TABLE public.experts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "experts_read" ON public.experts FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "experts_write" ON public.experts FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'manager'));
CREATE POLICY "experts_update" ON public.experts FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'manager'));
CREATE POLICY "experts_delete" ON public.experts FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'manager'));

CREATE TABLE public.agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  insurer_id uuid REFERENCES public.insurers(id) ON DELETE SET NULL,
  name text NOT NULL,
  network text,
  valid_from date, valid_to date,
  t1 numeric, t2 numeric, t3 numeric, tx_peint numeric,
  igp_o numeric, igp_v numeric, igp_n numeric,
  paint_rate numeric, commission_rate numeric, discount_rate numeric,
  replacement_vehicle text, erd text, glue_kit text,
  special_rules text, notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agreements TO authenticated;
GRANT ALL ON public.agreements TO service_role;
ALTER TABLE public.agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agreements_read" ON public.agreements FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "agreements_write" ON public.agreements FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'manager'));
CREATE POLICY "agreements_update" ON public.agreements FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'manager'));
CREATE POLICY "agreements_delete" ON public.agreements FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'manager'));

CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text,
  brands text,
  address text, postal_code text, city text,
  phone text, email text,
  sales_contact text, parts_contact text,
  returns_contact text, returns_email text,
  max_return_days integer, avg_credit_days integer,
  site_ids uuid[] NOT NULL DEFAULT '{}',
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "suppliers_read" ON public.suppliers FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "suppliers_write" ON public.suppliers FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "suppliers_update" ON public.suppliers FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "suppliers_delete" ON public.suppliers FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'manager'));

-- ============ DOSSIERS CARROSSERIE ============
CREATE TABLE public.bodyshop_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ref_vehicle_id uuid REFERENCES public.ref_vehicles(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  repair_order_id uuid REFERENCES public.repair_orders(id) ON DELETE SET NULL,
  plate text, vin text, or_number text,
  customer_name text, customer_phone text, customer_email text,
  vehicle_label text,
  mission_date date NOT NULL DEFAULT current_date,
  mission_origin text NOT NULL DEFAULT 'manuel',
  insurer_id uuid REFERENCES public.insurers(id) ON DELETE SET NULL,
  agreement_id uuid REFERENCES public.agreements(id) ON DELETE SET NULL,
  expert_firm_id uuid REFERENCES public.expert_firms(id) ON DELETE SET NULL,
  expert_id uuid REFERENCES public.experts(id) ON DELETE SET NULL,
  claim_number text, mission_number text,
  payer text, franchise numeric, vat_rate numeric, depreciation numeric,
  comments text,
  appointment_at timestamptz, entry_at timestamptz, expected_return_at timestamptz,
  work_location text NOT NULL DEFAULT 'site',
  subcontractor text, subcontract_sent_at date, subcontract_expected_at date, subcontract_returned_at date,
  subcontract_notes text,
  physical_state text NOT NULL DEFAULT 'pas_entre',
  case_state text NOT NULL DEFAULT 'rdv_a_prendre',
  blocker text, next_action text,
  is_hail boolean NOT NULL DEFAULT false,
  is_vge boolean NOT NULL DEFAULT false,
  amount_total_ht numeric, amount_total_ttc numeric,
  amount_insurer_expected numeric, amount_insurer_received numeric,
  amount_franchise_expected numeric, amount_franchise_received numeric,
  amount_depreciation_expected numeric, amount_depreciation_received numeric,
  amount_vat_expected numeric, amount_vat_received numeric,
  amount_other_expected numeric, amount_other_received numeric,
  closed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bodyshop_cases_plate_idx ON public.bodyshop_cases (plate);
CREATE INDEX bodyshop_cases_state_idx ON public.bodyshop_cases (case_state);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bodyshop_cases TO authenticated;
GRANT ALL ON public.bodyshop_cases TO service_role;
ALTER TABLE public.bodyshop_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cases_read" ON public.bodyshop_cases FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "cases_insert" ON public.bodyshop_cases FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "cases_update" ON public.bodyshop_cases FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "cases_delete" ON public.bodyshop_cases FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'manager'));

CREATE TABLE public.bodyshop_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.bodyshop_cases(id) ON DELETE CASCADE,
  kind text NOT NULL,
  label text NOT NULL,
  detail text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'app',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bodyshop_events_case_idx ON public.bodyshop_events (case_id, occurred_at DESC);
GRANT SELECT, INSERT ON public.bodyshop_events TO authenticated;
GRANT ALL ON public.bodyshop_events TO service_role;
ALTER TABLE public.bodyshop_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "events_read" ON public.bodyshop_events FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "events_insert" ON public.bodyshop_events FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));

CREATE TABLE public.bodyshop_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.bodyshop_cases(id) ON DELETE CASCADE,
  doc_type text NOT NULL DEFAULT 'autre',
  label text,
  storage_path text NOT NULL,
  mime_type text,
  file_size bigint,
  analysis jsonb,
  analysis_status text NOT NULL DEFAULT 'none',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bodyshop_documents_case_idx ON public.bodyshop_documents (case_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bodyshop_documents TO authenticated;
GRANT ALL ON public.bodyshop_documents TO service_role;
ALTER TABLE public.bodyshop_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "docs_read" ON public.bodyshop_documents FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "docs_insert" ON public.bodyshop_documents FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "docs_update" ON public.bodyshop_documents FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "docs_delete" ON public.bodyshop_documents FOR DELETE TO authenticated USING (public.is_active_user(auth.uid()));

CREATE TABLE public.bodyshop_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.bodyshop_cases(id) ON DELETE CASCADE,
  label text NOT NULL,
  detail text,
  origin text NOT NULL DEFAULT 'manuel',
  due_date date,
  done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  done_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bodyshop_tasks TO authenticated;
GRANT ALL ON public.bodyshop_tasks TO service_role;
ALTER TABLE public.bodyshop_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tasks_read" ON public.bodyshop_tasks FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "tasks_insert" ON public.bodyshop_tasks FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "tasks_update" ON public.bodyshop_tasks FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "tasks_delete" ON public.bodyshop_tasks FOR DELETE TO authenticated USING (public.is_active_user(auth.uid()));

CREATE TABLE public.bodyshop_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.bodyshop_cases(id) ON DELETE CASCADE,
  label text NOT NULL,
  reference text,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  is_deposit boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'prevue_rapport',
  ordered_at date, received_at date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bodyshop_parts TO authenticated;
GRANT ALL ON public.bodyshop_parts TO service_role;
ALTER TABLE public.bodyshop_parts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "parts_read" ON public.bodyshop_parts FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "parts_insert" ON public.bodyshop_parts FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "parts_update" ON public.bodyshop_parts FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "parts_delete" ON public.bodyshop_parts FOR DELETE TO authenticated USING (public.is_active_user(auth.uid()));

CREATE TABLE public.bodyshop_supplements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.bodyshop_cases(id) ON DELETE CASCADE,
  description text,
  photos text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'brouillon',
  sent_to text, sent_at timestamptz,
  response text, responded_at timestamptz,
  delay_impact_days integer,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bodyshop_supplements TO authenticated;
GRANT ALL ON public.bodyshop_supplements TO service_role;
ALTER TABLE public.bodyshop_supplements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "suppl_read" ON public.bodyshop_supplements FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "suppl_insert" ON public.bodyshop_supplements FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "suppl_update" ON public.bodyshop_supplements FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "suppl_delete" ON public.bodyshop_supplements FOR DELETE TO authenticated USING (public.is_active_user(auth.uid()));

CREATE TABLE public.bodyshop_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.bodyshop_cases(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'email',
  template_key text,
  recipient text,
  subject text,
  body text,
  status text NOT NULL DEFAULT 'brouillon',
  error_message text,
  sent_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bodyshop_communications TO authenticated;
GRANT ALL ON public.bodyshop_communications TO service_role;
ALTER TABLE public.bodyshop_communications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comm_read" ON public.bodyshop_communications FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "comm_insert" ON public.bodyshop_communications FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "comm_update" ON public.bodyshop_communications FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "comm_delete" ON public.bodyshop_communications FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'manager'));

CREATE TABLE public.bodyshop_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.bodyshop_cases(id) ON DELETE CASCADE,
  kind text NOT NULL,
  amount numeric NOT NULL,
  received_at date,
  reference text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bodyshop_payments TO authenticated;
GRANT ALL ON public.bodyshop_payments TO service_role;
ALTER TABLE public.bodyshop_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pay_read" ON public.bodyshop_payments FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "pay_insert" ON public.bodyshop_payments FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "pay_update" ON public.bodyshop_payments FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "pay_delete" ON public.bodyshop_payments FOR DELETE TO authenticated USING (public.is_active_user(auth.uid()));

-- ============ MAGASIN / RETOURS ============
CREATE SEQUENCE public.part_return_seq;

CREATE OR REPLACE FUNCTION public.next_part_return_ref()
RETURNS text LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT 'RET-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.part_return_seq')::text, 5, '0')
$$;

CREATE TABLE public.part_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE DEFAULT public.next_part_return_ref(),
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  case_id uuid REFERENCES public.bodyshop_cases(id) ON DELETE SET NULL,
  repair_order_id uuid REFERENCES public.repair_orders(id) ON DELETE SET NULL,
  ref_vehicle_id uuid REFERENCES public.ref_vehicles(id) ON DELETE SET NULL,
  plate text, or_number text,
  status text NOT NULL DEFAULT 'demande_creee',
  deadline_date date,
  notice_sent_at timestamptz,
  shipped_at timestamptz, shipped_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  carrier text, tracking_number text,
  shipment_photo text, shipment_note text,
  expected_amount numeric, credited_amount numeric,
  comments text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX part_returns_status_idx ON public.part_returns (status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.part_returns TO authenticated;
GRANT ALL ON public.part_returns TO service_role;
ALTER TABLE public.part_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ret_read" ON public.part_returns FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "ret_insert" ON public.part_returns FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "ret_update" ON public.part_returns FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "ret_delete" ON public.part_returns FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'manager'));

CREATE TABLE public.part_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.part_returns(id) ON DELETE CASCADE,
  bodyshop_part_id uuid REFERENCES public.bodyshop_parts(id) ON DELETE SET NULL,
  label text,
  reference text,
  quantity numeric NOT NULL DEFAULT 1,
  item_type text NOT NULL DEFAULT 'piece',
  unit_price numeric,
  photo_path text,
  credited_quantity numeric NOT NULL DEFAULT 0,
  credited_amount numeric,
  status text NOT NULL DEFAULT 'attendu',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.part_return_lines TO authenticated;
GRANT ALL ON public.part_return_lines TO service_role;
ALTER TABLE public.part_return_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "retl_read" ON public.part_return_lines FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "retl_insert" ON public.part_return_lines FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "retl_update" ON public.part_return_lines FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "retl_delete" ON public.part_return_lines FOR DELETE TO authenticated USING (public.is_active_user(auth.uid()));

CREATE TABLE public.credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  number text,
  credit_date date,
  total_amount numeric,
  storage_path text,
  analysis jsonb,
  status text NOT NULL DEFAULT 'a_rapprocher',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.credit_notes TO authenticated;
GRANT ALL ON public.credit_notes TO service_role;
ALTER TABLE public.credit_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cn_read" ON public.credit_notes FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "cn_insert" ON public.credit_notes FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "cn_update" ON public.credit_notes FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "cn_delete" ON public.credit_notes FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'manager'));

CREATE TABLE public.credit_note_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id uuid NOT NULL REFERENCES public.credit_notes(id) ON DELETE CASCADE,
  return_line_id uuid REFERENCES public.part_return_lines(id) ON DELETE SET NULL,
  reference text,
  label text,
  quantity numeric,
  amount numeric,
  matched boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.credit_note_lines TO authenticated;
GRANT ALL ON public.credit_note_lines TO service_role;
ALTER TABLE public.credit_note_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cnl_read" ON public.credit_note_lines FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "cnl_insert" ON public.credit_note_lines FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "cnl_update" ON public.credit_note_lines FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "cnl_delete" ON public.credit_note_lines FOR DELETE TO authenticated USING (public.is_active_user(auth.uid()));

CREATE TABLE public.return_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  return_ids uuid[] NOT NULL DEFAULT '{}',
  level integer NOT NULL DEFAULT 1,
  recipient text,
  subject text,
  body text,
  status text NOT NULL DEFAULT 'envoye',
  error_message text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.return_reminders TO authenticated;
GRANT ALL ON public.return_reminders TO service_role;
ALTER TABLE public.return_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rem_read" ON public.return_reminders FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "rem_insert" ON public.return_reminders FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "rem_update" ON public.return_reminders FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "rem_delete" ON public.return_reminders FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'manager'));

-- ============ TRIGGERS updated_at ============
CREATE TRIGGER trg_insurers_updated BEFORE UPDATE ON public.insurers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_expert_firms_updated BEFORE UPDATE ON public.expert_firms FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_experts_updated BEFORE UPDATE ON public.experts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_agreements_updated BEFORE UPDATE ON public.agreements FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_suppliers_updated BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_cases_updated BEFORE UPDATE ON public.bodyshop_cases FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON public.bodyshop_tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_bparts_updated BEFORE UPDATE ON public.bodyshop_parts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_suppl_updated BEFORE UPDATE ON public.bodyshop_supplements FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_returns_updated BEFORE UPDATE ON public.part_returns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_retlines_updated BEFORE UPDATE ON public.part_return_lines FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_cnotes_updated BEFORE UPDATE ON public.credit_notes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
