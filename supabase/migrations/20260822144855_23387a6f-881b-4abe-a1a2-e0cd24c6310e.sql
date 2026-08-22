-- 1. Paramétrage global : sévérité IA + grille d'usure administrable
ALTER TABLE public.commercial_settings
  ADD COLUMN IF NOT EXISTS ai_severity_level text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS tire_depth_good_mm numeric NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS tire_depth_soon_mm numeric NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS tire_depth_legal_mm numeric NOT NULL DEFAULT 1.6;

ALTER TABLE public.commercial_settings
  DROP CONSTRAINT IF EXISTS commercial_settings_ai_severity_level_check;
ALTER TABLE public.commercial_settings
  ADD CONSTRAINT commercial_settings_ai_severity_level_check
  CHECK (ai_severity_level IN ('permissif', 'standard', 'severe'));

-- 2. Catalogue pneumatiques enrichi
ALTER TABLE public.tire_offers
  ADD COLUMN IF NOT EXISTS load_index text,
  ADD COLUMN IF NOT EXISTS speed_index text,
  ADD COLUMN IF NOT EXISTS availability text,
  ADD COLUMN IF NOT EXISTS supplier_ref text,
  ADD COLUMN IF NOT EXISTS supplier_key text;

-- 3. Marques par gamme (administrable)
CREATE TABLE IF NOT EXISTS public.tire_brand_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier text NOT NULL CHECK (tier IN ('entree', 'milieu', 'haut')),
  brand text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  site_id uuid REFERENCES public.sites(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tire_brand_tiers_unique
  ON public.tire_brand_tiers (tier, lower(brand), COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tire_brand_tiers TO authenticated;
GRANT ALL ON public.tire_brand_tiers TO service_role;
ALTER TABLE public.tire_brand_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tire_brand_tiers_select" ON public.tire_brand_tiers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "tire_brand_tiers_write" ON public.tire_brand_tiers
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'manager'));

CREATE TRIGGER update_tire_brand_tiers_updated_at
  BEFORE UPDATE ON public.tire_brand_tiers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.tire_brand_tiers (tier, brand, is_default, sort_order) VALUES
  ('entree', 'Sailun', true, 1),
  ('entree', 'Linglong', false, 2),
  ('entree', 'Goodride', false, 3),
  ('entree', 'Tracmax', false, 4),
  ('entree', 'Triangle', false, 5),
  ('entree', 'Imperial', false, 6),
  ('milieu', 'Kleber', true, 1),
  ('milieu', 'Hankook', false, 2),
  ('milieu', 'Falken', false, 3),
  ('milieu', 'Kumho', false, 4),
  ('milieu', 'Nexen', false, 5),
  ('milieu', 'Uniroyal', false, 6),
  ('milieu', 'Firestone', false, 7),
  ('haut', 'Michelin', true, 1),
  ('haut', 'Goodyear', false, 2),
  ('haut', 'Continental', false, 3),
  ('haut', 'Bridgestone', false, 4),
  ('haut', 'Pirelli', false, 5),
  ('haut', 'Dunlop', false, 6)
ON CONFLICT DO NOTHING;

-- 4. Offres pneumatiques préparées (traçabilité complète)
CREATE TABLE IF NOT EXISTS public.tire_quote_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid REFERENCES public.vehicle_inspections(id) ON DELETE CASCADE,
  inspection_point_id uuid REFERENCES public.inspection_points(id) ON DELETE CASCADE,
  wheel_code text,
  kind text NOT NULL,
  tier text,
  season text,
  brand text,
  model text,
  size text,
  load_index text,
  speed_index text,
  quantity integer NOT NULL DEFAULT 2,
  supplier text,
  supplier_ref text,
  consulted_at timestamptz NOT NULL DEFAULT now(),
  source_price_ht numeric,
  source_price_ttc numeric,
  margin_ht numeric,
  sell_price_ht numeric,
  mount_package text,
  mount_total_ttc numeric,
  total_ht numeric,
  total_vat numeric,
  total_ttc numeric,
  availability text,
  compatibility text,
  selected boolean NOT NULL DEFAULT false,
  initial_payload jsonb,
  final_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tire_quote_offers_point_idx ON public.tire_quote_offers (inspection_point_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tire_quote_offers TO authenticated;
GRANT ALL ON public.tire_quote_offers TO service_role;
ALTER TABLE public.tire_quote_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tire_quote_offers_select" ON public.tire_quote_offers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "tire_quote_offers_insert" ON public.tire_quote_offers
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "tire_quote_offers_update" ON public.tire_quote_offers
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "tire_quote_offers_delete" ON public.tire_quote_offers
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'manager'));

CREATE TRIGGER update_tire_quote_offers_updated_at
  BEFORE UPDATE ON public.tire_quote_offers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Point de contrôle : données d'étiquette pneumatique lues sur le véhicule
ALTER TABLE public.inspection_points
  ADD COLUMN IF NOT EXISTS tire_label jsonb;