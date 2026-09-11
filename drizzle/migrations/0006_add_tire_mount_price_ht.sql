ALTER TABLE public.commercial_settings
  ADD COLUMN IF NOT EXISTS tire_mount_price_ht numeric NOT NULL DEFAULT 17.00;

COMMENT ON COLUMN public.commercial_settings.tire_mount_price_ht IS
  'Prix de montage par pneu en euros HT (montage + equilibrage + valve), utilise par le moteur pneus partage.';