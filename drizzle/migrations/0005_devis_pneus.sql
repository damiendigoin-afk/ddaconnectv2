-- Devis pneus manuels (nouvelle porte d'entrée vers le moteur de chiffrage existant).
CREATE TABLE IF NOT EXISTS public.tire_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  site_label text,
  user_id uuid,
  user_name text,
  size text NOT NULL,
  width text,
  height text,
  diameter text,
  load_index text,
  speed_index text,
  requested_brand text,
  customer_name text,
  plate text,
  vehicle_label text,
  quantity int NOT NULL DEFAULT 2,
  offers jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tire_quotes_created_at_idx ON public.tire_quotes (created_at DESC);
CREATE INDEX IF NOT EXISTS tire_quotes_size_idx ON public.tire_quotes (size);
CREATE INDEX IF NOT EXISTS tire_quotes_plate_idx ON public.tire_quotes (plate);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tire_quotes TO authenticated;
GRANT ALL ON public.tire_quotes TO service_role;
ALTER TABLE public.tire_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "devis pneus lecture connectes" ON public.tire_quotes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "devis pneus creation connectes" ON public.tire_quotes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "devis pneus maj connectes" ON public.tire_quotes
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "devis pneus suppression manager" ON public.tire_quotes
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'manager'));