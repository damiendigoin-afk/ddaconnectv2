ALTER TABLE public.vehicle_expertises
  ADD COLUMN IF NOT EXISTS ref_vehicle_id uuid REFERENCES public.ref_vehicles(id),
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id);
CREATE INDEX IF NOT EXISTS idx_vehicle_expertises_ref_vehicle ON public.vehicle_expertises(ref_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_expertises_customer ON public.vehicle_expertises(customer_id);