ALTER TABLE public.vehicle_inspections
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid,
  ADD COLUMN IF NOT EXISTS archived_by_name text,
  ADD COLUMN IF NOT EXISTS last_modified_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_modified_by uuid,
  ADD COLUMN IF NOT EXISTS last_modified_by_name text,
  ADD COLUMN IF NOT EXISTS creation_source text,
  ADD COLUMN IF NOT EXISTS close_source text;

CREATE INDEX IF NOT EXISTS vehicle_inspections_completed_at_idx ON public.vehicle_inspections (completed_at DESC);
CREATE INDEX IF NOT EXISTS vehicle_inspections_updated_at_idx ON public.vehicle_inspections (updated_at DESC);
CREATE INDEX IF NOT EXISTS vehicle_inspections_archived_at_idx ON public.vehicle_inspections (archived_at);

CREATE OR REPLACE FUNCTION public.enforce_single_inspection_per_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.repair_order_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.vehicle_inspections v
    WHERE v.repair_order_id = NEW.repair_order_id
      AND v.id <> NEW.id
      AND v.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Un Tour Véhicule existe déjà pour ce dossier'
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_single_inspection_per_order ON public.vehicle_inspections;
CREATE TRIGGER enforce_single_inspection_per_order
  BEFORE INSERT ON public.vehicle_inspections
  FOR EACH ROW EXECUTE FUNCTION public.enforce_single_inspection_per_order();

ALTER TABLE public.inspection_points
  ADD COLUMN IF NOT EXISTS battery_test jsonb,
  ADD COLUMN IF NOT EXISTS battery_media_id uuid;

ALTER TABLE public.tire_offers
  ADD COLUMN IF NOT EXISTS price_kind text NOT NULL DEFAULT 'purchase_ht',
  ADD COLUMN IF NOT EXISTS source_url text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tire_offers_price_kind_check'
  ) THEN
    ALTER TABLE public.tire_offers
      ADD CONSTRAINT tire_offers_price_kind_check
      CHECK (price_kind IN ('purchase_ht', 'public_ttc'));
  END IF;
END $$;

ALTER TABLE public.commercial_settings
  ADD COLUMN IF NOT EXISTS tire_provider_last_ok_at timestamptz,
  ADD COLUMN IF NOT EXISTS tire_provider_status text,
  ADD COLUMN IF NOT EXISTS tire_provider_message text;

INSERT INTO public.service_packages (brand, operation_code, label, price_ttc, active)
SELECT v.brand, v.code, v.label, v.price, true
FROM (VALUES
  ('Renault', 'RTPNE0', 'Montage 1 pneu SSPP (niveau 0)', 39.00),
  ('Renault', 'RTPNF0', 'Montage 2 pneus SSPP (niveau 0)', 69.00),
  ('Renault', 'RTPNG0', 'Montage 4 pneus SSPP (niveau 0)', 129.00)
) AS v(brand, code, label, price)
WHERE NOT EXISTS (
  SELECT 1 FROM public.service_packages p WHERE p.operation_code = v.code
);