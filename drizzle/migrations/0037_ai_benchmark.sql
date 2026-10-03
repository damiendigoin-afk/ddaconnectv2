CREATE TABLE public.ai_bench_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  candidate_model text NOT NULL DEFAULT 'google/gemini-3.8-flash',
  daily_credits numeric NOT NULL DEFAULT 3,
  max_credits_per_test numeric NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT, INSERT, UPDATE ON public.ai_bench_settings TO authenticated;
GRANT ALL ON public.ai_bench_settings TO service_role;
ALTER TABLE public.ai_bench_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY bench_settings_mgr ON public.ai_bench_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'manager'));

CREATE TABLE public.ai_bench_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  notes text,
  model_a text,
  model_b text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_bench_campaigns TO authenticated;
GRANT ALL ON public.ai_bench_campaigns TO service_role;
ALTER TABLE public.ai_bench_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY bench_campaigns_mgr ON public.ai_bench_campaigns FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'manager'));

CREATE TABLE public.ai_bench_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.ai_bench_campaigns(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  mime text,
  sha256 text NOT NULL,
  storage_paths text[] NOT NULL DEFAULT '{}',
  page_count integer,
  photo_count integer NOT NULL DEFAULT 1,
  detected_kind text,
  kind_confidence numeric,
  kind_source text,
  corrected_kind text,
  local_text_chars integer,
  expected jsonb,
  scores jsonb,
  timings jsonb,
  app_version text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_bench_tests_campaign_idx ON public.ai_bench_tests(campaign_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_bench_tests TO authenticated;
GRANT ALL ON public.ai_bench_tests TO service_role;
ALTER TABLE public.ai_bench_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY bench_tests_mgr ON public.ai_bench_tests FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'manager'));

CREATE TABLE public.ai_bench_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id uuid NOT NULL REFERENCES public.ai_bench_tests(id) ON DELETE CASCADE,
  variant text NOT NULL CHECK (variant IN ('A','B','pipeline')),
  model text NOT NULL,
  prompt_version text,
  prompt_hash text,
  prompt_text text,
  schema_version text,
  doc_kind text,
  started_at timestamptz,
  media_ms integer,
  ai_ms integer,
  parse_ms integer,
  server_ms integer,
  total_ms integer,
  tokens_in integer,
  tokens_out integer,
  credits numeric,
  http_status integer,
  success boolean NOT NULL DEFAULT false,
  cache_hit boolean NOT NULL DEFAULT false,
  failure_reason text,
  route text,
  ai_calls integer,
  parsed jsonb,
  raw_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_bench_runs_test_idx ON public.ai_bench_runs(test_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_bench_runs TO authenticated;
GRANT ALL ON public.ai_bench_runs TO service_role;
ALTER TABLE public.ai_bench_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY bench_runs_mgr ON public.ai_bench_runs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'manager'));