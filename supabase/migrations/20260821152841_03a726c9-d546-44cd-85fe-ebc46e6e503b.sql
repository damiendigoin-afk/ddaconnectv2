CREATE TABLE public.pricing_grids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  effective_from date NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.pricing_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grid_id uuid NOT NULL REFERENCES public.pricing_grids(id) ON DELETE CASCADE,
  category text NOT NULL,
  code text NOT NULL,
  label text NOT NULL,
  amount_ht numeric(10,2),
  amount_ttc numeric(10,2),
  unit text NOT NULL DEFAULT 'heure',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (grid_id, code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pricing_grids TO authenticated;
GRANT ALL ON public.pricing_grids TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pricing_rates TO authenticated;
GRANT ALL ON public.pricing_rates TO service_role;

ALTER TABLE public.pricing_grids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pricing_grids_select" ON public.pricing_grids FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "pricing_grids_write" ON public.pricing_grids FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'manager'));
CREATE POLICY "pricing_rates_select" ON public.pricing_rates FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "pricing_rates_write" ON public.pricing_rates FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'manager'));

CREATE TRIGGER update_pricing_grids_updated_at BEFORE UPDATE ON public.pricing_grids FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_pricing_rates_updated_at BEFORE UPDATE ON public.pricing_rates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.vehicle_expertises
  ADD COLUMN IF NOT EXISTS pricing_grid_id uuid REFERENCES public.pricing_grids(id),
  ADD COLUMN IF NOT EXISTS pricing_snapshot jsonb;

INSERT INTO public.pricing_grids (id, name, effective_from, notes)
VALUES ('11111111-2026-4000-8000-000000000001', 'Grille DDA 2026', '2026-01-01', 'Grille tarifaire atelier en vigueur');

INSERT INTO public.pricing_rates (grid_id, category, code, label, amount_ht, amount_ttc, unit, sort_order) VALUES
('11111111-2026-4000-8000-000000000001','labor','taux_0','Taux 0',49.90,59.88,'heure',10),
('11111111-2026-4000-8000-000000000001','labor','taux_1','Taux 1',66.60,79.92,'heure',20),
('11111111-2026-4000-8000-000000000001','labor','taux_2','Taux 2(taux technique par défaut)',74.90,89.88,'heure',30),
('11111111-2026-4000-8000-000000000001','labor','taux_3','Taux 3',83.25,99.90,'heure',40),
('11111111-2026-4000-8000-000000000001','igp','igp_opaque','Opaque',49.90,59.88,'heure',10),
('11111111-2026-4000-8000-000000000001','igp','igp_metallisee','Métallisée vernie',55.00,66.00,'heure',20),
('11111111-2026-4000-8000-000000000001','igp','igp_nacree','Nacrée',65.00,78.00,'heure',30),
('11111111-2026-4000-8000-000000000001','service','geometrie','Géométrie',82.50,99.00,'forfait',10),
('11111111-2026-4000-8000-000000000001','service','clim_r134a','Climatisation R134A',82.50,99.00,'forfait',20),
('11111111-2026-4000-8000-000000000001','service','clim_1234yf','Climatisation 1234YF',229.17,275.00,'forfait',30),
('11111111-2026-4000-8000-000000000001','service','diagnostic','Diagnostic',82.50,99.00,'forfait',40),
('11111111-2026-4000-8000-000000000001','service','lecture_codes','Lecture codes défaut',40.83,49.00,'forfait',50),
('11111111-2026-4000-8000-000000000001','service','gardiennage','Gardiennage',20.00,24.00,'jour',60),
('11111111-2026-4000-8000-000000000001','service','dechets_moins_1000','Frais déchets (facture < 1 000 €)',10.00,12.00,'forfait',70),
('11111111-2026-4000-8000-000000000001','service','dechets_1000_plus','Frais déchets (facture >= 1 000 €)',20.00,24.00,'forfait',80);