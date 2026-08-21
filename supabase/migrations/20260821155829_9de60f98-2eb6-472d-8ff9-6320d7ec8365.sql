
-- 1. Paramètres commerciaux (singleton)
CREATE TABLE IF NOT EXISTS public.commercial_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  margin_pct numeric NOT NULL DEFAULT 35,
  min_margin_ht numeric NOT NULL DEFAULT 15,
  tire_supplier text NOT NULL DEFAULT 'catalogue_local',
  tire_supplier_configured boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.commercial_settings TO authenticated;
GRANT INSERT, UPDATE ON public.commercial_settings TO authenticated;
GRANT ALL ON public.commercial_settings TO service_role;
ALTER TABLE public.commercial_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY commercial_settings_read ON public.commercial_settings FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY commercial_settings_write ON public.commercial_settings FOR ALL TO authenticated USING (public.has_role(auth.uid(),'manager')) WITH CHECK (public.has_role(auth.uid(),'manager'));
INSERT INTO public.commercial_settings (margin_pct, min_margin_ht) SELECT 35, 15 WHERE NOT EXISTS (SELECT 1 FROM public.commercial_settings);

-- 2. Forfaits mécaniques (référentiel Renault / Dacia)
CREATE TABLE IF NOT EXISTS public.service_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL,
  segment text,
  model text,
  energies text[] NOT NULL DEFAULT '{}',
  operation_code text NOT NULL,
  label text NOT NULL,
  hours numeric,
  parts_ht numeric,
  price_ttc numeric,
  rate_code text NOT NULL DEFAULT 'taux_2',
  year_from int,
  year_to int,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_packages_lookup ON public.service_packages (operation_code, brand, segment);
GRANT SELECT ON public.service_packages TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.service_packages TO authenticated;
GRANT ALL ON public.service_packages TO service_role;
ALTER TABLE public.service_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_packages_read ON public.service_packages FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY service_packages_write ON public.service_packages FOR ALL TO authenticated USING (public.has_role(auth.uid(),'manager')) WITH CHECK (public.has_role(auth.uid(),'manager'));

-- 3. Règles peinture / D-R par élément
CREATE TABLE IF NOT EXISTS public.paint_element_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  element_key text NOT NULL UNIQUE,
  label text NOT NULL,
  element_size text NOT NULL,
  paint_hours numeric NOT NULL,
  repair_hours_default numeric NOT NULL DEFAULT 0,
  dr_operations jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.paint_element_rules TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.paint_element_rules TO authenticated;
GRANT ALL ON public.paint_element_rules TO service_role;
ALTER TABLE public.paint_element_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY paint_rules_read ON public.paint_element_rules FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY paint_rules_write ON public.paint_element_rules FOR ALL TO authenticated USING (public.has_role(auth.uid(),'manager')) WITH CHECK (public.has_role(auth.uid(),'manager'));

INSERT INTO public.paint_element_rules (element_key, label, element_size, paint_hours, repair_hours_default, dr_operations) VALUES
 ('retroviseur','Rétroviseur','petit',0.5,0.3,'[]'::jsonb),
 ('bas_de_caisse','Bas de caisse','moyen',1.2,0.8,'[]'::jsonb),
 ('porte_avant','Porte avant','moyen',1.5,1.0,'[{"code":"dr_poignee","label":"D/R poignée extérieure","hours":0.3},{"code":"dr_lecheur","label":"D/R lécheur","hours":0.3}]'::jsonb),
 ('porte_arriere','Porte arrière','moyen',1.5,1.0,'[{"code":"dr_poignee","label":"D/R poignée extérieure","hours":0.3},{"code":"dr_lecheur","label":"D/R lécheur","hours":0.3}]'::jsonb),
 ('aile_avant','Aile avant','moyen',1.5,1.0,'[]'::jsonb),
 ('aile_arriere','Aile arrière','gros',2.0,1.5,'[]'::jsonb),
 ('capot','Capot','gros',2.0,1.2,'[]'::jsonb),
 ('hayon','Hayon','gros',2.0,1.2,'[]'::jsonb),
 ('bouclier_avant','Bouclier avant','gros',2.0,1.0,'[]'::jsonb),
 ('bouclier_arriere','Bouclier arrière','gros',2.0,1.0,'[]'::jsonb)
ON CONFLICT (element_key) DO NOTHING;

-- 4. Catalogue pneumatiques (source tarifaire configurable)
CREATE TABLE IF NOT EXISTS public.tire_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier text NOT NULL,
  season text NOT NULL,
  brand text NOT NULL,
  model text NOT NULL,
  size text,
  purchase_price_ht numeric NOT NULL,
  mount_price_ttc numeric NOT NULL DEFAULT 20,
  source text NOT NULL DEFAULT 'catalogue_local',
  price_date date NOT NULL DEFAULT current_date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tire_offers TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.tire_offers TO authenticated;
GRANT ALL ON public.tire_offers TO service_role;
ALTER TABLE public.tire_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tire_offers_read ON public.tire_offers FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY tire_offers_write ON public.tire_offers FOR ALL TO authenticated USING (public.has_role(auth.uid(),'manager')) WITH CHECK (public.has_role(auth.uid(),'manager'));

-- 5. Devis centralisés
CREATE TABLE IF NOT EXISTS public.pricing_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid,
  source_module text NOT NULL,
  source_id uuid,
  repair_order_id uuid,
  ref_vehicle_id uuid,
  plate text,
  status text NOT NULL DEFAULT 'draft',
  share_token text NOT NULL DEFAULT encode(gen_random_bytes(16),'hex'),
  rates_snapshot jsonb,
  total_ht numeric NOT NULL DEFAULT 0,
  total_ttc numeric NOT NULL DEFAULT 0,
  created_by uuid,
  created_by_name text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pricing_quotes_token ON public.pricing_quotes (share_token);
CREATE INDEX IF NOT EXISTS pricing_quotes_source ON public.pricing_quotes (source_module, source_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pricing_quotes TO authenticated;
GRANT ALL ON public.pricing_quotes TO service_role;
ALTER TABLE public.pricing_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY pricing_quotes_all ON public.pricing_quotes FOR ALL TO authenticated USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));

CREATE TABLE IF NOT EXISTS public.pricing_quote_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.pricing_quotes(id) ON DELETE CASCADE,
  block text NOT NULL DEFAULT 'mecanique',
  label text NOT NULL,
  detail text,
  priority text NOT NULL DEFAULT 'a_surveiller',
  origin_point_key text,
  media_id uuid,
  price_source text NOT NULL DEFAULT 'saisie_manuelle',
  confidence text NOT NULL DEFAULT 'moyenne',
  needs_contact boolean NOT NULL DEFAULT false,
  quantity numeric NOT NULL DEFAULT 1,
  hours numeric,
  unit_ht numeric,
  total_ht numeric NOT NULL DEFAULT 0,
  total_ttc numeric NOT NULL DEFAULT 0,
  computation jsonb,
  client_response text NOT NULL DEFAULT 'pending',
  client_comment text,
  responded_at timestamptz,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pricing_quote_lines_quote ON public.pricing_quote_lines (quote_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pricing_quote_lines TO authenticated;
GRANT ALL ON public.pricing_quote_lines TO service_role;
ALTER TABLE public.pricing_quote_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY pricing_quote_lines_all ON public.pricing_quote_lines FOR ALL TO authenticated USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));

-- 6. Traçabilité IA / corrections opérateur
CREATE TABLE IF NOT EXISTS public.ai_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL,
  subject text NOT NULL,
  context text,
  ref_vehicle_id uuid,
  plate text,
  source_id uuid,
  media_id uuid,
  ai_result jsonb,
  ai_confidence text,
  human_result jsonb,
  final_result jsonb,
  corrected boolean NOT NULL DEFAULT false,
  user_id uuid,
  user_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_corrections_subject ON public.ai_corrections (subject, created_at DESC);
GRANT SELECT, INSERT ON public.ai_corrections TO authenticated;
GRANT ALL ON public.ai_corrections TO service_role;
ALTER TABLE public.ai_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_corrections_read ON public.ai_corrections FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY ai_corrections_insert ON public.ai_corrections FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));

-- 7. Colonnes additives
ALTER TABLE public.ref_vehicles
  ADD COLUMN IF NOT EXISTS segment text,
  ADD COLUMN IF NOT EXISTS homologated_tire_size text,
  ADD COLUMN IF NOT EXISTS tire_size_source text;

ALTER TABLE public.inspection_points
  ADD COLUMN IF NOT EXISTS tire_analysis jsonb,
  ADD COLUMN IF NOT EXISTS tire_sidewall jsonb,
  ADD COLUMN IF NOT EXISTS photo_quality text,
  ADD COLUMN IF NOT EXISTS ai_confidence text;

-- 8. Triggers updated_at
DROP TRIGGER IF EXISTS t_service_packages_updated ON public.service_packages;
CREATE TRIGGER t_service_packages_updated BEFORE UPDATE ON public.service_packages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS t_paint_rules_updated ON public.paint_element_rules;
CREATE TRIGGER t_paint_rules_updated BEFORE UPDATE ON public.paint_element_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS t_tire_offers_updated ON public.tire_offers;
CREATE TRIGGER t_tire_offers_updated BEFORE UPDATE ON public.tire_offers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS t_pricing_quotes_updated ON public.pricing_quotes;
CREATE TRIGGER t_pricing_quotes_updated BEFORE UPDATE ON public.pricing_quotes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS t_pricing_quote_lines_updated ON public.pricing_quote_lines;
CREATE TRIGGER t_pricing_quote_lines_updated BEFORE UPDATE ON public.pricing_quote_lines FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
