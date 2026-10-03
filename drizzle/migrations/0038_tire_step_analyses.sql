CREATE TABLE public.tire_step_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id),
  plate text,
  or_number text,
  position text,
  photo_paths text[] NOT NULL DEFAULT '{}',
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  corrected jsonb,
  model text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.tire_step_analyses TO authenticated;
GRANT ALL ON public.tire_step_analyses TO service_role;
ALTER TABLE public.tire_step_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tire_step_read ON public.tire_step_analyses FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()) AND (site_id IS NULL OR public.user_can_access_site(auth.uid(), site_id)));
CREATE POLICY tire_step_insert ON public.tire_step_analyses FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user(auth.uid()) AND created_by = auth.uid() AND (site_id IS NULL OR public.user_can_access_site(auth.uid(), site_id)));
CREATE INDEX tire_step_plate_idx ON public.tire_step_analyses (plate, created_at DESC);
COMMENT ON COLUMN public.ai_bench_settings.daily_credits IS 'DEPRECATED: the bench now uses ai_budget_settings.daily_credits (single shared daily budget)';