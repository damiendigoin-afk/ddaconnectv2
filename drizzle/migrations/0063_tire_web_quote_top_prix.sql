ALTER TABLE public.tire_web_quote_settings DROP CONSTRAINT IF EXISTS tire_web_quote_enabled_blocked;
ALTER TABLE public.tire_web_quote_settings DROP CONSTRAINT IF EXISTS tire_web_quote_settings_web_supplier_check;
ALTER TABLE public.tire_web_quote_settings
  ADD CONSTRAINT tire_web_quote_settings_web_supplier_check CHECK (web_supplier IS NULL OR web_supplier = 'top_prix');
ALTER TABLE public.tire_web_quote_settings
  ADD COLUMN IF NOT EXISTS allowed_origin text NULL DEFAULT 'https://dda-pneus-premiere-version.genialdrake34.chatgpt.site',
  ADD COLUMN IF NOT EXISTS quota_ip_per_10min integer NOT NULL DEFAULT 10 CHECK (quota_ip_per_10min BETWEEN 1 AND 1000),
  ADD COLUMN IF NOT EXISTS quota_global_per_hour integer NOT NULL DEFAULT 120 CHECK (quota_global_per_hour BETWEEN 1 AND 100000);

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
    IF NEW.allowed_origin IS NULL OR NEW.allowed_origin !~* '^https://[a-z0-9.-]+(:[0-9]+)?$' THEN
      RAISE EXCEPTION 'Activation refusée : origine autorisée invalide.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tire_web_quote_settings_guard ON public.tire_web_quote_settings;
CREATE TRIGGER tire_web_quote_settings_guard BEFORE INSERT OR UPDATE ON public.tire_web_quote_settings
  FOR EACH ROW EXECUTE FUNCTION public.tire_web_quote_settings_guard();
REVOKE ALL ON FUNCTION public.tire_web_quote_settings_guard() FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.tire_web_quote_quota (
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
GRANT ALL ON public.tire_web_quote_quota TO service_role;
ALTER TABLE public.tire_web_quote_quota ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.tire_web_quota_hit(p_bucket text, p_window_seconds integer, p_limit integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w timestamptz := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);
  n integer;
BEGIN
  INSERT INTO public.tire_web_quote_quota (bucket, window_start, hits) VALUES (p_bucket, w, 1)
  ON CONFLICT (bucket, window_start) DO UPDATE SET hits = public.tire_web_quote_quota.hits + 1
  RETURNING hits INTO n;
  DELETE FROM public.tire_web_quote_quota WHERE window_start < now() - interval '2 days';
  RETURN n <= p_limit;
END $$;
REVOKE ALL ON FUNCTION public.tire_web_quota_hit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tire_web_quota_hit(text, integer, integer) TO service_role;

INSERT INTO public.tire_web_quote_settings (id, web_supplier, enabled)
VALUES (true, 'top_prix', false)
ON CONFLICT (id) DO UPDATE SET web_supplier = 'top_prix', enabled = false, updated_at = now();