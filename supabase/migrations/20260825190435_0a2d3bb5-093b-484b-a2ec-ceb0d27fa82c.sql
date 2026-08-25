
-- 1. Cache des analyses IA (empreinte de média + fonction + modèle)
CREATE TABLE public.ai_cache (
  fingerprint TEXT PRIMARY KEY,
  feature TEXT NOT NULL,
  model TEXT NOT NULL,
  content TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_cache TO authenticated;
GRANT ALL ON public.ai_cache TO service_role;
ALTER TABLE public.ai_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_cache_manager_read" ON public.ai_cache FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'manager'));

-- 2. Journal des opérations IA payantes
CREATE TABLE public.ai_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID,
  site_id UUID,
  feature TEXT NOT NULL,
  entity TEXT,
  fingerprint TEXT,
  provider TEXT NOT NULL DEFAULT 'lovable-ai',
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  calls INTEGER NOT NULL DEFAULT 1,
  retries INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  http_status INTEGER,
  success BOOLEAN NOT NULL DEFAULT false,
  cache_hit BOOLEAN NOT NULL DEFAULT false,
  blocked_reason TEXT,
  estimated_credits NUMERIC(12,4) NOT NULL DEFAULT 0
);
CREATE INDEX ai_usage_log_created_idx ON public.ai_usage_log (created_at DESC);
CREATE INDEX ai_usage_log_feature_idx ON public.ai_usage_log (feature);
GRANT SELECT ON public.ai_usage_log TO authenticated;
GRANT ALL ON public.ai_usage_log TO service_role;
ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_usage_log_manager_read" ON public.ai_usage_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'manager'));

-- 3. Budgets IA paramétrables (ligne unique)
CREATE TABLE public.ai_budget_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_credits NUMERIC(12,4) NOT NULL DEFAULT 5,
  monthly_credits NUMERIC(12,4) NOT NULL DEFAULT 150,
  max_credits_per_operation NUMERIC(12,4) NOT NULL DEFAULT 1,
  fallback_ai_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_budget_settings TO authenticated;
GRANT INSERT, UPDATE ON public.ai_budget_settings TO authenticated;
GRANT ALL ON public.ai_budget_settings TO service_role;
ALTER TABLE public.ai_budget_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_budget_read" ON public.ai_budget_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "ai_budget_manager_write" ON public.ai_budget_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'manager'));
INSERT INTO public.ai_budget_settings DEFAULT VALUES;

-- 4. Reprise serveur des imports (jobs persistés)
CREATE TABLE public.import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key TEXT NOT NULL UNIQUE,
  user_id UUID,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT,
  file_fingerprint TEXT,
  total_pages INTEGER,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'running',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX import_jobs_user_idx ON public.import_jobs (user_id, updated_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_jobs TO authenticated;
GRANT ALL ON public.import_jobs TO service_role;
ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "import_jobs_owner_all" ON public.import_jobs FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'manager'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'manager'));
