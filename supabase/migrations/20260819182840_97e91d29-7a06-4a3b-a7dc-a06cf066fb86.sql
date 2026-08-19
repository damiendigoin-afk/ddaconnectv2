-- DARVA
CREATE TABLE public.darva_flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  case_id uuid REFERENCES public.bodyshop_cases(id) ON DELETE SET NULL,
  reference text,
  claim_ref text,
  insurer text,
  plate text,
  message_type text NOT NULL DEFAULT 'mission',
  direction text NOT NULL DEFAULT 'in',
  status text NOT NULL DEFAULT 'a_traiter',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  amount numeric,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.darva_flows TO authenticated;
GRANT ALL ON public.darva_flows TO service_role;
ALTER TABLE public.darva_flows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "darva_all" ON public.darva_flows FOR ALL TO authenticated
  USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));
CREATE TRIGGER trg_darva_updated BEFORE UPDATE ON public.darva_flows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Maintenance prédictive
CREATE TABLE public.maintenance_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  ref_vehicle_id uuid REFERENCES public.ref_vehicles(id) ON DELETE CASCADE,
  plate text,
  customer_name text,
  alert_type text NOT NULL DEFAULT 'revision',
  last_km integer,
  last_seen_at date,
  km_per_month integer,
  due_km integer,
  due_date date,
  risk text NOT NULL DEFAULT 'moyen',
  status text NOT NULL DEFAULT 'ouverte',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_alerts TO authenticated;
GRANT ALL ON public.maintenance_alerts TO service_role;
ALTER TABLE public.maintenance_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "maint_all" ON public.maintenance_alerts FOR ALL TO authenticated
  USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));
CREATE TRIGGER trg_maint_updated BEFORE UPDATE ON public.maintenance_alerts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Base de connaissances
CREATE TABLE public.knowledge_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  body text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  pinned boolean NOT NULL DEFAULT false,
  author_id uuid,
  author_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_articles TO authenticated;
GRANT ALL ON public.knowledge_articles TO service_role;
ALTER TABLE public.knowledge_articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kb_read" ON public.knowledge_articles FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()));
CREATE POLICY "kb_write" ON public.knowledge_articles FOR ALL TO authenticated
  USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));
CREATE TRIGGER trg_kb_updated BEFORE UPDATE ON public.knowledge_articles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Récupération / VN / VO
CREATE TABLE public.vehicle_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'recuperation',
  plate text,
  vin text,
  model text,
  customer_name text,
  customer_phone text,
  address text,
  scheduled_at timestamptz,
  done_at timestamptz,
  status text NOT NULL DEFAULT 'planifie',
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_handovers TO authenticated;
GRANT ALL ON public.vehicle_handovers TO service_role;
ALTER TABLE public.vehicle_handovers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "handover_all" ON public.vehicle_handovers FOR ALL TO authenticated
  USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));
CREATE TRIGGER trg_handover_updated BEFORE UPDATE ON public.vehicle_handovers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Notes de frais
CREATE TABLE public.expense_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_name text,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  spent_on date NOT NULL DEFAULT current_date,
  category text NOT NULL DEFAULT 'carburant',
  merchant text,
  amount_ttc numeric NOT NULL DEFAULT 0,
  vat_amount numeric,
  receipt_path text,
  status text NOT NULL DEFAULT 'brouillon',
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  reject_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_notes TO authenticated;
GRANT ALL ON public.expense_notes TO service_role;
ALTER TABLE public.expense_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exp_own_read" ON public.expense_notes FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'manager'));
CREATE POLICY "exp_own_insert" ON public.expense_notes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "exp_update" ON public.expense_notes FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'manager'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'manager'));
CREATE POLICY "exp_delete" ON public.expense_notes FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'manager'));
CREATE TRIGGER trg_expense_updated BEFORE UPDATE ON public.expense_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Automatisations (RPA)
CREATE TABLE public.automation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key text NOT NULL UNIQUE,
  label text NOT NULL,
  description text,
  schedule text,
  enabled boolean NOT NULL DEFAULT false,
  last_run_at timestamptz,
  last_status text,
  last_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_jobs TO authenticated;
GRANT ALL ON public.automation_jobs TO service_role;
ALTER TABLE public.automation_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auto_jobs_manager" ON public.automation_jobs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'manager'));
CREATE TRIGGER trg_auto_jobs_updated BEFORE UPDATE ON public.automation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.automation_jobs(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'en_cours',
  message text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_runs TO authenticated;
GRANT ALL ON public.automation_runs TO service_role;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auto_runs_manager" ON public.automation_runs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'manager'));

INSERT INTO public.automation_jobs (job_key, label, description, schedule, enabled) VALUES
  ('purge_drafts', 'Purge des brouillons', 'Supprime les tours et retours abandonnés depuis plus de 7 jours.', '0 3 * * *', true),
  ('maintenance_scan', 'Détection des échéances', 'Recalcule les alertes de maintenance prédictive à partir des kilométrages.', '0 4 * * 1', false),
  ('emails_sync', 'Synchronisation des boîtes', 'Relève les boîtes connectées et classe les nouveaux messages.', '*/30 * * * *', false)
ON CONFLICT (job_key) DO NOTHING;