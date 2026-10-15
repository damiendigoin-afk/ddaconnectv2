CREATE TABLE public.tire_supplier_site_settings (
  site_id uuid PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
  default_supplier text NOT NULL DEFAULT 'centralepneus',
  districash_account text,
  districash_last_test_at timestamptz,
  districash_last_test_ok boolean,
  districash_last_test_message text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.tire_supplier_site_settings TO authenticated;
GRANT ALL ON public.tire_supplier_site_settings TO service_role;
ALTER TABLE public.tire_supplier_site_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tsss read" ON public.tire_supplier_site_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "tsss manager insert" ON public.tire_supplier_site_settings FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'manager'));
CREATE POLICY "tsss manager update" ON public.tire_supplier_site_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'manager'));
INSERT INTO public.tire_supplier_site_settings (site_id, default_supplier, districash_account) VALUES
 ('23f64579-eaa9-406d-aec7-d29731ba0020', 'centralepneus', '19025'),
 ('92f38b10-7444-44e1-8d86-84ce6b510a59', 'centralepneus', '60669');