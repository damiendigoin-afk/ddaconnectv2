ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS latitude double precision NULL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  ADD COLUMN IF NOT EXISTS longitude double precision NULL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);

ALTER TABLE public.tire_web_appointment_requests
  ADD COLUMN IF NOT EXISTS site_choice_method text NULL
    CHECK (site_choice_method IS NULL OR site_choice_method IN ('default', 'geolocation', 'postal', 'manual')),
  ADD COLUMN IF NOT EXISTS suggested_site_id uuid NULL REFERENCES public.sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notification_status text NOT NULL DEFAULT 'pending'
    CHECK (notification_status IN ('pending', 'sent', 'failed', 'not_configured')),
  ADD COLUMN IF NOT EXISTS notification_error text NULL,
  ADD COLUMN IF NOT EXISTS notified_at timestamptz NULL;