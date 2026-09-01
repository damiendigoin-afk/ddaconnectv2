CREATE TABLE public.activity_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_code text NOT NULL,
  file_name text,
  imported_by uuid,
  imported_by_name text,
  months_count integer NOT NULL DEFAULT 0,
  values_count integer NOT NULL DEFAULT 0,
  anomalies jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_imports TO authenticated;
GRANT ALL ON public.activity_imports TO service_role;
ALTER TABLE public.activity_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "activity_imports read" ON public.activity_imports FOR SELECT TO authenticated USING (true);
CREATE POLICY "activity_imports write" ON public.activity_imports FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "activity_imports update" ON public.activity_imports FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.activity_months (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_code text NOT NULL,
  period_start date NOT NULL,
  sheet_name text,
  status text NOT NULL DEFAULT 'provisoire',
  status_manual boolean NOT NULL DEFAULT false,
  import_id uuid REFERENCES public.activity_imports(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_code, period_start)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_months TO authenticated;
GRANT ALL ON public.activity_months TO service_role;
ALTER TABLE public.activity_months ENABLE ROW LEVEL SECURITY;
CREATE POLICY "activity_months read" ON public.activity_months FOR SELECT TO authenticated USING (true);
CREATE POLICY "activity_months insert" ON public.activity_months FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "activity_months update" ON public.activity_months FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "activity_months delete" ON public.activity_months FOR DELETE TO authenticated USING (true);

CREATE TABLE public.activity_values (
  month_id uuid NOT NULL REFERENCES public.activity_months(id) ON DELETE CASCADE,
  indicator_key text NOT NULL,
  value numeric,
  PRIMARY KEY (month_id, indicator_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_values TO authenticated;
GRANT ALL ON public.activity_values TO service_role;
ALTER TABLE public.activity_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "activity_values read" ON public.activity_values FOR SELECT TO authenticated USING (true);
CREATE POLICY "activity_values insert" ON public.activity_values FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "activity_values update" ON public.activity_values FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "activity_values delete" ON public.activity_values FOR DELETE TO authenticated USING (true);

CREATE INDEX activity_values_indicator_idx ON public.activity_values (indicator_key);
CREATE INDEX activity_months_period_idx ON public.activity_months (period_start);