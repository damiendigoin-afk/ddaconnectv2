ALTER TABLE public.ai_usage_log ADD COLUMN IF NOT EXISTS route text;
UPDATE public.ai_usage_log SET route = CASE WHEN cache_hit THEN 'cache' ELSE 'ai_vision_fallback' END WHERE route IS NULL;

CREATE TABLE IF NOT EXISTS public.supplier_doc_profiles (
  supplier_key text PRIMARY KEY,
  supplier_name text NOT NULL,
  header_tokens text[] NOT NULL DEFAULT '{}',
  doc_number_label text,
  uses integer NOT NULL DEFAULT 0,
  rules_success integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.supplier_doc_profiles TO authenticated;
GRANT ALL ON public.supplier_doc_profiles TO service_role;
ALTER TABLE public.supplier_doc_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read supplier doc profiles" ON public.supplier_doc_profiles FOR SELECT TO authenticated USING (true);