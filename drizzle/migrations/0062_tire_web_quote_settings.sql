CREATE TABLE public.tire_web_quote_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  web_supplier text NULL CHECK (web_supplier IS NULL OR web_supplier IN ('centralepneus','catalogue_local','districash')),
  site_id uuid NULL REFERENCES public.sites(id) ON DELETE SET NULL,
  -- Activation bloquée tant qu'aucune façade publique sécurisée n'existe.
  enabled boolean NOT NULL DEFAULT false CONSTRAINT tire_web_quote_enabled_blocked CHECK (enabled = false),
  updated_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.tire_web_quote_settings TO authenticated;
GRANT ALL ON public.tire_web_quote_settings TO service_role;
ALTER TABLE public.tire_web_quote_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "managers read web tire settings" ON public.tire_web_quote_settings FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'manager'));
CREATE POLICY "managers insert web tire settings" ON public.tire_web_quote_settings FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'manager'));
CREATE POLICY "managers update web tire settings" ON public.tire_web_quote_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'manager')) WITH CHECK (public.has_role(auth.uid(),'manager'));