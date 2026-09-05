-- 1) Référentiel forfaits : contexte mémento enrichi et versioning
ALTER TABLE public.service_packages
  ADD COLUMN IF NOT EXISTS family text,
  ADD COLUMN IF NOT EXISTS operation_title text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS engine text,
  ADD COLUMN IF NOT EXISTS generation text,
  ADD COLUMN IF NOT EXISTS zone text,
  ADD COLUMN IF NOT EXISTS tier text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS import_id uuid;

CREATE INDEX IF NOT EXISTS service_packages_kind_version_idx
  ON public.service_packages (source_kind, source_version);
CREATE INDEX IF NOT EXISTS service_packages_code_idx
  ON public.service_packages (operation_code);
CREATE INDEX IF NOT EXISTS service_packages_label_trgm_idx
  ON public.service_packages USING gin (label gin_trgm_ops);
CREATE INDEX IF NOT EXISTS service_packages_model_trgm_idx
  ON public.service_packages USING gin (coalesce(model, '') gin_trgm_ops);

-- 2) Équivalences véhicules (référentiel consultable, extensible)
CREATE TABLE IF NOT EXISTS public.vehicle_equivalences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_a text NOT NULL,
  model_a text NOT NULL,
  brand_b text NOT NULL,
  model_b text NOT NULL,
  segment text,
  body_type text,
  generation text,
  year_from int,
  year_to int,
  engine text,
  confidence text NOT NULL DEFAULT 'moyen',
  reason text,
  scope text NOT NULL DEFAULT 'generaliste',
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_equivalences TO authenticated;
GRANT ALL ON public.vehicle_equivalences TO service_role;
ALTER TABLE public.vehicle_equivalences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "equivalences lecture connectes" ON public.vehicle_equivalences
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "equivalences ecriture manager" ON public.vehicle_equivalences
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'manager'));
CREATE POLICY "equivalences maj manager" ON public.vehicle_equivalences
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'manager'));
CREATE POLICY "equivalences suppression manager" ON public.vehicle_equivalences
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'manager'));

CREATE INDEX IF NOT EXISTS vehicle_equivalences_models_idx
  ON public.vehicle_equivalences (model_a, model_b);

-- 3) Communication par site
ALTER TABLE public.ad_assets
  ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

CREATE INDEX IF NOT EXISTS ad_assets_site_idx ON public.ad_assets (site_id);

CREATE TABLE IF NOT EXISTS public.communication_settings (
  site_id uuid PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
  monthly_budget numeric,
  radius_km int,
  gbp_url text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.communication_settings TO authenticated;
GRANT ALL ON public.communication_settings TO service_role;
ALTER TABLE public.communication_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "com settings lecture connectes" ON public.communication_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "com settings ecriture connectes" ON public.communication_settings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "com settings maj connectes" ON public.communication_settings
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);

-- 4) Paramètres API : catégories et cartes de connexion
ALTER TABLE public.api_settings
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'cle',
  ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 100;

INSERT INTO public.api_settings (service, label, category, sort_order, active)
SELECT v.service, v.label, v.category, v.sort_order, false
FROM (VALUES
  ('ixellio', 'IXELLIO', 'cle', 50),
  ('meta', 'Meta (Facebook / Instagram)', 'oauth', 200),
  ('google_business', 'Google Business Profile', 'oauth', 210)
) AS v(service, label, category, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.api_settings a WHERE a.service = v.service);