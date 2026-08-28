ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS tire_size_front text,
  ADD COLUMN IF NOT EXISTS tire_size_rear text,
  ADD COLUMN IF NOT EXISTS tire_size_confirmed_at timestamptz;