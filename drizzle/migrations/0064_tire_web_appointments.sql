ALTER TABLE public.tire_web_quote_settings
  ADD COLUMN IF NOT EXISTS allowed_origins text[] NOT NULL
  DEFAULT ARRAY['https://dda-pneus-premiere-version.genialdrake34.chatgpt.site', 'https://pneu.garagecastillon.fr']::text[];
UPDATE public.tire_web_quote_settings
  SET allowed_origins = ARRAY(SELECT DISTINCT unnest(ARRAY[allowed_origin, 'https://pneu.garagecastillon.fr']) WHERE allowed_origin IS NOT NULL)
  WHERE allowed_origin IS NOT NULL;
COMMENT ON COLUMN public.tire_web_quote_settings.allowed_origin IS 'DEPRECATED: replaced by allowed_origins';

CREATE OR REPLACE FUNCTION public.tire_web_quote_settings_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.enabled THEN
    IF NEW.web_supplier IS DISTINCT FROM 'top_prix' THEN
      RAISE EXCEPTION 'Activation refusée : le mode Top prix doit être choisi.';
    END IF;
    IF NEW.site_id IS NULL THEN
      RAISE EXCEPTION 'Activation refusée : établissement requis (compte Districash propre au site).';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.integration_credentials
      WHERE provider = 'districash:' || NEW.site_id::text
        AND username_enc IS NOT NULL AND password_enc IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Activation refusée : identifiants Districash absents pour cet établissement.';
    END IF;
    IF coalesce(array_length(NEW.allowed_origins, 1), 0) = 0
       OR EXISTS (SELECT 1 FROM unnest(NEW.allowed_origins) o WHERE o !~* '^https://[a-z0-9.-]+(:[0-9]+)?$') THEN
      RAISE EXCEPTION 'Activation refusée : origines autorisées invalides.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tire_web_quote_settings_guard() FROM PUBLIC, anon, authenticated;

CREATE TABLE public.tire_web_quotes (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  request jsonb NOT NULL,
  cases jsonb NOT NULL
);
GRANT SELECT ON public.tire_web_quotes TO authenticated;
GRANT ALL ON public.tire_web_quotes TO service_role;
ALTER TABLE public.tire_web_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "managers read web tire quotes" ON public.tire_web_quotes
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'manager'::app_role));
CREATE INDEX tire_web_quotes_created_idx ON public.tire_web_quotes (created_at);

CREATE TABLE public.tire_web_appointment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'a_confirmer'
    CHECK (status IN ('a_confirmer', 'confirme', 'refuse', 'annule', 'traite')),
  quote_id uuid NOT NULL REFERENCES public.tire_web_quotes(id),
  selected_tier text NOT NULL CHECK (selected_tier IN ('entree', 'milieu', 'haut')),
  selected_season text NOT NULL CHECK (selected_season IN ('ete', 'quatre_saisons')),
  offer_snapshot jsonb NOT NULL,
  customer_name text NOT NULL,
  phone text NULL,
  email text NULL,
  plate text NULL,
  preferred_slots jsonb NOT NULL DEFAULT '[]'::jsonb,
  message text NULL,
  consent_at timestamptz NOT NULL,
  ip_hash text NULL,
  origin text NULL,
  site_id uuid NULL REFERENCES public.sites(id) ON DELETE SET NULL,
  handled_by uuid NULL,
  handled_at timestamptz NULL,
  internal_note text NULL
);
GRANT SELECT, UPDATE ON public.tire_web_appointment_requests TO authenticated;
GRANT ALL ON public.tire_web_appointment_requests TO service_role;
ALTER TABLE public.tire_web_appointment_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "managers read web tire appointment requests" ON public.tire_web_appointment_requests
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'manager'::app_role));
CREATE POLICY "managers update web tire appointment requests" ON public.tire_web_appointment_requests
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));
CREATE INDEX tire_web_appt_status_idx ON public.tire_web_appointment_requests (status, created_at DESC);