CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.vehicle_expertises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  repair_order_id uuid REFERENCES public.repair_orders(id) ON DELETE SET NULL,
  site_id uuid REFERENCES public.sites(id),
  expertise_type text NOT NULL DEFAULT 'reprise',
  plate text,
  vin text,
  brand text,
  model text,
  version text,
  first_registration date,
  energy text,
  color text,
  owner_name text,
  mileage integer,
  keys_count text,
  registration_doc text NOT NULL DEFAULT 'non_verifiee',
  exterior_condition text,
  interior_condition text,
  general_comment text,
  status text NOT NULL DEFAULT 'draft',
  step text NOT NULL DEFAULT 'identite',
  share_token uuid NOT NULL DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES auth.users(id),
  created_by_name text,
  completed_at timestamptz,
  last_sent_at timestamptz,
  last_sent_to text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_expertises TO authenticated;
GRANT SELECT ON public.vehicle_expertises TO anon;
GRANT ALL ON public.vehicle_expertises TO service_role;
ALTER TABLE public.vehicle_expertises ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expertises readable" ON public.vehicle_expertises FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "expertises insert" ON public.vehicle_expertises FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "expertises update" ON public.vehicle_expertises FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "expertises delete" ON public.vehicle_expertises FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'manager'::app_role));

CREATE TABLE public.expertise_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expertise_id uuid NOT NULL REFERENCES public.vehicle_expertises(id) ON DELETE CASCADE,
  photo_type text NOT NULL,
  category text NOT NULL DEFAULT 'exterieur',
  label text,
  sequence integer NOT NULL DEFAULT 0,
  required boolean NOT NULL DEFAULT false,
  storage_path text NOT NULL,
  report_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expertise_photos TO authenticated;
GRANT SELECT ON public.expertise_photos TO anon;
GRANT ALL ON public.expertise_photos TO service_role;
ALTER TABLE public.expertise_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expertise photos readable" ON public.expertise_photos FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "expertise photos write" ON public.expertise_photos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "expertise photos update" ON public.expertise_photos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "expertise photos delete" ON public.expertise_photos FOR DELETE TO authenticated USING (true);

CREATE TABLE public.expertise_damages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expertise_id uuid NOT NULL REFERENCES public.vehicle_expertises(id) ON DELETE CASCADE,
  photo_id uuid REFERENCES public.expertise_photos(id) ON DELETE SET NULL,
  damage_number integer NOT NULL DEFAULT 1,
  damage_type text,
  vehicle_zone text,
  recommended_action text,
  comment text,
  estimated_cost numeric(10,2),
  cost_pending boolean NOT NULL DEFAULT false,
  annotation_data jsonb,
  ai_suggestion jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expertise_damages TO authenticated;
GRANT SELECT ON public.expertise_damages TO anon;
GRANT ALL ON public.expertise_damages TO service_role;
ALTER TABLE public.expertise_damages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expertise damages readable" ON public.expertise_damages FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "expertise damages insert" ON public.expertise_damages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "expertise damages update" ON public.expertise_damages FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "expertise damages delete" ON public.expertise_damages FOR DELETE TO authenticated USING (true);

CREATE TABLE public.repair_price_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id),
  damage_type text,
  action text NOT NULL,
  label text NOT NULL,
  amount numeric(10,2),
  manual_only boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.repair_price_rules TO authenticated;
GRANT SELECT ON public.repair_price_rules TO anon;
GRANT ALL ON public.repair_price_rules TO service_role;
ALTER TABLE public.repair_price_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "price rules readable" ON public.repair_price_rules FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "managers manage price rules insert" ON public.repair_price_rules FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));
CREATE POLICY "managers manage price rules update" ON public.repair_price_rules FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'manager'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));
CREATE POLICY "managers manage price rules delete" ON public.repair_price_rules FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'manager'::app_role));

CREATE TRIGGER update_vehicle_expertises_updated_at BEFORE UPDATE ON public.vehicle_expertises
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_expertise_damages_updated_at BEFORE UPDATE ON public.expertise_damages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_repair_price_rules_updated_at BEFORE UPDATE ON public.repair_price_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_expertise_photos_expertise ON public.expertise_photos(expertise_id);
CREATE INDEX idx_expertise_damages_expertise ON public.expertise_damages(expertise_id);
CREATE INDEX idx_expertises_created_at ON public.vehicle_expertises(created_at DESC);

INSERT INTO public.repair_price_rules (action, label, amount, manual_only) VALUES
  ('aucune', 'Aucune intervention', 0, false),
  ('polissage', 'Polissage / rénovation', 120, false),
  ('debosselage', 'Débosselage sans peinture', 150, false),
  ('peinture', 'Peinture élément', 300, false),
  ('reparation_peinture', 'Réparation + peinture élément', 500, false),
  ('remplacement', 'Remplacement (pièce + main d''œuvre)', NULL, true),
  ('a_expertiser', 'À expertiser', NULL, true);