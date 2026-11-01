-- DDA Pneus V10 — MIGRATION PRÉPARÉE, NON APPLIQUÉE.
-- Volontairement hors de drizzle/migrations : ne s'applique qu'après validation explicite
-- (le backend sert aussi la production). À passer alors tel quel par l'outil de migration.
-- Prérequis : public.has_role(uuid, app_role), public.sites, public.tire_web_quotes.

-- 1. Demandes commerciales = prospects rattachés à un garage
CREATE TABLE public.tyre_commercial_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,              -- idempotence (UUID fourni par le site)
  reference text NOT NULL UNIQUE,
  payload_hash text NOT NULL,
  quote_id uuid NOT NULL,
  tier text NOT NULL CHECK (tier IN ('entree','milieu','haut')),
  season text NOT NULL CHECK (season IN ('ete','quatre_saisons')),
  site_key text NOT NULL CHECK (site_key IN ('castillon','lalinde')),
  site_id uuid NOT NULL REFERENCES public.sites(id),
  customer_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  message text,
  consent_at timestamptz NOT NULL,
  google_verified boolean NOT NULL DEFAULT false,
  offer_snapshot jsonb NOT NULL,
  total_ttc_cents integer NOT NULL CHECK (total_ttc_cents > 0),
  valid_until timestamptz NOT NULL,
  prospect_status text NOT NULL DEFAULT 'nouveau'
    CHECK (prospect_status IN ('nouveau','a_contacter','contacte','rdv_pris','vendu','perdu')),
  delivery_status text NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending','sending','delivered','partial','not_delivered')),
  emails_attempted_at timestamptz,   -- posé AVANT tout envoi ; rejeu => jamais de renvoi
  fo_recipient text,                 -- destinataire Front Office validé réellement utilisé
  client_email_status text CHECK (client_email_status IN ('sent','failed','not_configured','not_sent')),
  fo_email_status text CHECK (fo_email_status IN ('sent','failed','not_configured','not_sent')),
  delivery_error text,
  pdf_path text,
  response_status integer,
  response_body jsonb,
  ip_hash text,
  origin text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tyre_commercial_requests_site_created ON public.tyre_commercial_requests (site_id, created_at DESC);
CREATE INDEX tyre_commercial_requests_status ON public.tyre_commercial_requests (prospect_status);
GRANT SELECT, UPDATE ON public.tyre_commercial_requests TO authenticated;
GRANT ALL ON public.tyre_commercial_requests TO service_role;
ALTER TABLE public.tyre_commercial_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "managers read tyre requests of their sites" ON public.tyre_commercial_requests
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'manager') AND public.user_can_access_site(auth.uid(), site_id));
CREATE POLICY "managers update tyre requests of their sites" ON public.tyre_commercial_requests
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'manager') AND public.user_can_access_site(auth.uid(), site_id))
  WITH CHECK (public.has_role(auth.uid(), 'manager') AND public.user_can_access_site(auth.uid(), site_id));
-- Pas d'INSERT/DELETE côté utilisateurs : création uniquement par le serveur (service_role).
CREATE TRIGGER tyre_commercial_requests_updated BEFORE UPDATE ON public.tyre_commercial_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Événements de trafic (aucune coordonnée, aucune URL libre)
CREATE TABLE public.tyre_web_events (
  event_id uuid PRIMARY KEY,                    -- déduplication
  type text NOT NULL CHECK (type IN ('page_view','session_start','quote_generated','offer_selected','request_submitted')),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  consent boolean NOT NULL,
  visitor_id text CHECK (visitor_id IS NULL OR consent),
  session_id text CHECK (session_id IS NULL OR consent),
  page text, device text, utm_source text, utm_medium text, utm_campaign text,
  size text, quantity smallint, tier text, season text, site_key text,
  paris_day date NOT NULL, paris_hour smallint NOT NULL, paris_weekday smallint NOT NULL
);
CREATE INDEX tyre_web_events_day ON public.tyre_web_events (paris_day, type);
GRANT SELECT ON public.tyre_web_events TO authenticated;
GRANT ALL ON public.tyre_web_events TO service_role;
ALTER TABLE public.tyre_web_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "managers read tyre events" ON public.tyre_web_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'manager'));

-- 3. Rapport quotidien (idempotence par date Paris)
CREATE TABLE public.tyre_daily_reports (
  report_date date PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('running','sent','failed')),
  attempts integer NOT NULL DEFAULT 1,
  send_key text,                     -- clé d'idempotence d'envoi (conservée si issue inconnue)
  started_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
GRANT SELECT ON public.tyre_daily_reports TO authenticated;
GRANT ALL ON public.tyre_daily_reports TO service_role;
ALTER TABLE public.tyre_daily_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "managers read tyre reports" ON public.tyre_daily_reports
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'manager'));

-- 4. PDF : bucket PRIVÉ `tyre-commercial-quotes` à créer par l'outil de stockage (pas en SQL).
--    Chemin : <site_key>/<AAAA-MM>/<request_id>.pdf. Lecture managers du garage via URL signée.
CREATE POLICY "managers read tyre commercial pdfs" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'tyre-commercial-quotes'
    AND public.has_role(auth.uid(), 'manager')
    AND EXISTS (
      SELECT 1 FROM public.tyre_commercial_requests r
      WHERE r.pdf_path = storage.objects.name AND public.user_can_access_site(auth.uid(), r.site_id)
    )
  );
-- Aucune politique anon : pas de listing ni de lecture publique.
