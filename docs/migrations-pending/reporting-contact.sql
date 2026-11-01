-- =====================================================================
-- DDA Pneus — reporting quotidien + journal technique contact-request
-- PHASE 1 : fichier PRÉPARÉ, NON APPLIQUÉ. Additif et idempotent (rejouable).
-- N'utilise QUE des objets préfixés tyre_rpt_* ; ne modifie aucune table,
-- fonction ou tâche planifiée existante ; indépendant de la migration V10
-- (tyre_web_events / tyre_daily_reports / CRM restent hors de ce fichier).
-- Aucun secret en clair : le jeton du planificateur est généré DANS Vault.
-- =====================================================================

-- 1. Réglages (ligne unique id = 1). Tout désactivé par défaut.
CREATE TABLE IF NOT EXISTS public.tyre_rpt_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  events_enabled boolean NOT NULL DEFAULT false,
  report_enabled boolean NOT NULL DEFAULT false,
  contact_log_enabled boolean NOT NULL DEFAULT false,
  instrumentation_started_at timestamptz,          -- posé automatiquement à la 1re activation
  retention_days integer NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 7 AND 365),
  test_emails text[] NOT NULL DEFAULT '{}',          -- règle serveur explicite des tests techniques
  test_email_domains text[] NOT NULL DEFAULT '{}',
  test_visitor_ids text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.tyre_rpt_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
GRANT SELECT ON public.tyre_rpt_settings TO authenticated;
GRANT ALL ON public.tyre_rpt_settings TO service_role;
ALTER TABLE public.tyre_rpt_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "managers read tyre rpt settings" ON public.tyre_rpt_settings;
CREATE POLICY "managers read tyre rpt settings" ON public.tyre_rpt_settings
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'manager'));

CREATE OR REPLACE FUNCTION public.tyre_rpt_settings_stamp() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.events_enabled AND NEW.instrumentation_started_at IS NULL THEN
    NEW.instrumentation_started_at := now();          -- jamais réécrit ensuite
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.instrumentation_started_at IS NOT NULL THEN
    NEW.instrumentation_started_at := OLD.instrumentation_started_at;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tyre_rpt_settings_stamp ON public.tyre_rpt_settings;
CREATE TRIGGER tyre_rpt_settings_stamp BEFORE INSERT OR UPDATE ON public.tyre_rpt_settings
  FOR EACH ROW EXECUTE FUNCTION public.tyre_rpt_settings_stamp();

-- 2. Événements d'audience (aucune coordonnée, aucune IP, aucune URL libre). Rétention : retention_days.
CREATE TABLE IF NOT EXISTS public.tyre_rpt_events (
  event_id uuid PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('page_view','session_start','quote_generated','offer_selected','request_submitted')),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  consent boolean NOT NULL,
  visitor_id text CHECK (visitor_id IS NULL OR consent),
  session_id text CHECK (session_id IS NULL OR consent),
  page text, device text, utm_source text, utm_medium text, utm_campaign text,
  size text, quantity smallint, tier text, season text, site_key text,
  paris_day date NOT NULL, paris_hour smallint NOT NULL, paris_weekday smallint NOT NULL,
  quote_id uuid, offer_brand text, offer_verified boolean NOT NULL DEFAULT false,
  is_test boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS tyre_rpt_events_occurred ON public.tyre_rpt_events (occurred_at, event_id);
CREATE INDEX IF NOT EXISTS tyre_rpt_events_quote ON public.tyre_rpt_events (quote_id) WHERE quote_id IS NOT NULL;
GRANT SELECT ON public.tyre_rpt_events TO authenticated;
GRANT ALL ON public.tyre_rpt_events TO service_role;
ALTER TABLE public.tyre_rpt_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "managers read tyre rpt events" ON public.tyre_rpt_events;
CREATE POLICY "managers read tyre rpt events" ON public.tyre_rpt_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'manager'));

-- 3. Journal technique des demandes de contact (≠ prospect CRM). Une ligne par requestId.
--    Contient nom/e-mail/téléphone/message : purge après retention_days (30 j par défaut).
CREATE TABLE IF NOT EXISTS public.tyre_rpt_contact_log (
  request_id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  site_key text NOT NULL CHECK (site_key IN ('castillon','lalinde')),
  status text NOT NULL CHECK (status IN ('sending','sent','failed','unknown')),
  attempts integer NOT NULL DEFAULT 1,
  error_code text CHECK (error_code IS NULL OR error_code IN ('email_failed','email_busy','request_conflict','send_exception')),
  is_test boolean NOT NULL DEFAULT false,
  name text NOT NULL CHECK (length(name) <= 100),
  email text NOT NULL CHECK (length(email) <= 255),
  phone text NOT NULL CHECK (length(phone) <= 30),
  message text CHECK (message IS NULL OR length(message) <= 500),
  quote_id uuid NOT NULL, tier text NOT NULL, season text NOT NULL,
  brand text, model text, size text, load_index text, speed_index text, quantity smallint,
  total_ttc_cents integer, total_label text,
  visitor_id text                                    -- seulement si contexte analytics consenti
);
CREATE INDEX IF NOT EXISTS tyre_rpt_contact_log_created ON public.tyre_rpt_contact_log (created_at, request_id);
GRANT SELECT ON public.tyre_rpt_contact_log TO authenticated;
GRANT ALL ON public.tyre_rpt_contact_log TO service_role;
ALTER TABLE public.tyre_rpt_contact_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "managers read tyre rpt contacts" ON public.tyre_rpt_contact_log;
CREATE POLICY "managers read tyre rpt contacts" ON public.tyre_rpt_contact_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'manager'));

-- 4. Compteurs journaliers cumulés SANS PII (conservés ; comparatifs après purge).
CREATE TABLE IF NOT EXISTS public.tyre_rpt_daily_counters (
  report_date date NOT NULL,
  metric text NOT NULL CHECK (metric ~ '^[a-z_]{1,40}$'),
  value integer NOT NULL CHECK (value >= 0),
  PRIMARY KEY (report_date, metric)
);
GRANT SELECT ON public.tyre_rpt_daily_counters TO authenticated;
GRANT ALL ON public.tyre_rpt_daily_counters TO service_role;
ALTER TABLE public.tyre_rpt_daily_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "managers read tyre rpt counters" ON public.tyre_rpt_daily_counters;
CREATE POLICY "managers read tyre rpt counters" ON public.tyre_rpt_daily_counters
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'manager'));

-- 5. Émissions du rapport : une ligne par date Paris (idempotence).
CREATE TABLE IF NOT EXISTS public.tyre_rpt_daily_reports (
  report_date date PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('running','sent','failed')),
  attempts integer NOT NULL DEFAULT 1,
  send_key text,
  provider_id text,
  -- Snapshot figé avant envoi (contient des coordonnées) : réutilisé à l'identique par tout nouvel essai, purgé après retention_days.
  snapshot_subject text, snapshot_html text, snapshot_csv text, snapshot_counters jsonb,
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tyre_rpt_daily_reports ADD COLUMN IF NOT EXISTS snapshot_subject text;
ALTER TABLE public.tyre_rpt_daily_reports ADD COLUMN IF NOT EXISTS snapshot_html text;
ALTER TABLE public.tyre_rpt_daily_reports ADD COLUMN IF NOT EXISTS snapshot_csv text;
ALTER TABLE public.tyre_rpt_daily_reports ADD COLUMN IF NOT EXISTS snapshot_counters jsonb;
GRANT SELECT ON public.tyre_rpt_daily_reports TO authenticated;
GRANT ALL ON public.tyre_rpt_daily_reports TO service_role;
ALTER TABLE public.tyre_rpt_daily_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "managers read tyre rpt reports" ON public.tyre_rpt_daily_reports;
CREATE POLICY "managers read tyre rpt reports" ON public.tyre_rpt_daily_reports
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'manager'));

-- 6. RPC service_role uniquement ------------------------------------------------

-- 6a. Début de journal : nouvelle ligne, ou rejeu => attempts+1 sans modifier le contenu initial.
CREATE OR REPLACE FUNCTION public.tyre_rpt_contact_begin(p_row jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.tyre_rpt_contact_log; inserted boolean;
BEGIN
  r := jsonb_populate_record(NULL::public.tyre_rpt_contact_log, p_row);
  INSERT INTO public.tyre_rpt_contact_log AS t (request_id, site_key, status, attempts, is_test, name, email, phone, message,
    quote_id, tier, season, brand, model, size, load_index, speed_index, quantity, total_ttc_cents, total_label, visitor_id)
  VALUES (r.request_id, r.site_key, 'sending', 1, coalesce(r.is_test, false), r.name, r.email, r.phone, r.message,
    r.quote_id, r.tier, r.season, r.brand, r.model, r.size, r.load_index, r.speed_index, r.quantity, r.total_ttc_cents, r.total_label, r.visitor_id)
  ON CONFLICT (request_id) DO UPDATE SET attempts = t.attempts + 1, last_attempt_at = now()
  RETURNING (xmax = 0) INTO inserted;
  RETURN inserted;
END $$;

-- 6b. Fin de tentative : ne rétrograde JAMAIS une demande déjà « sent ».
CREATE OR REPLACE FUNCTION public.tyre_rpt_contact_finish(p_request_id uuid, p_status text, p_error_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_status NOT IN ('sent','failed','unknown') THEN RAISE EXCEPTION 'invalid status'; END IF;
  UPDATE public.tyre_rpt_contact_log
     SET status = p_status, error_code = CASE WHEN p_status = 'sent' THEN NULL ELSE p_error_code END, last_attempt_at = now()
   WHERE request_id = p_request_id AND status <> 'sent';
END $$;

-- 6c. Réservation atomique de l'émission d'une date.
CREATE OR REPLACE FUNCTION public.tyre_rpt_claim_report(p_report_date date, p_stale_seconds integer, p_max_attempts integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.tyre_rpt_daily_reports;
BEGIN
  INSERT INTO public.tyre_rpt_daily_reports (report_date, status, attempts) VALUES (p_report_date, 'running', 1)
  ON CONFLICT (report_date) DO NOTHING;
  IF FOUND THEN RETURN jsonb_build_object('claimed', true, 'attempt', 1, 'previous', 'none', 'prev_key', NULL); END IF;
  SELECT * INTO r FROM public.tyre_rpt_daily_reports WHERE report_date = p_report_date FOR UPDATE;
  IF r.status = 'sent' THEN RETURN jsonb_build_object('claimed', false, 'reason', 'already_sent'); END IF;
  IF r.attempts >= p_max_attempts THEN RETURN jsonb_build_object('claimed', false, 'reason', 'max_attempts'); END IF;
  IF r.status = 'failed' THEN
    UPDATE public.tyre_rpt_daily_reports SET status = 'running', attempts = attempts + 1, started_at = now(), finished_at = NULL
     WHERE report_date = p_report_date;
    RETURN jsonb_build_object('claimed', true, 'attempt', r.attempts + 1, 'previous', 'failed', 'prev_key', r.send_key);
  END IF;
  IF r.started_at < now() - make_interval(secs => p_stale_seconds) THEN
    UPDATE public.tyre_rpt_daily_reports SET attempts = attempts + 1, started_at = now() WHERE report_date = p_report_date;
    RETURN jsonb_build_object('claimed', true, 'attempt', r.attempts + 1, 'previous', 'stale', 'prev_key', r.send_key);
  END IF;
  RETURN jsonb_build_object('claimed', false, 'reason', 'running');
END $$;

-- 6d. Vérification du bearer du planificateur contre le secret Vault (comparaison d'empreintes).
CREATE OR REPLACE FUNCTION public.tyre_rpt_verify_cron_token(p_token text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE s text;
BEGIN
  SELECT decrypted_secret INTO s FROM vault.decrypted_secrets WHERE name = 'tyre_reporting_cron_token' LIMIT 1;
  IF s IS NULL OR p_token IS NULL OR length(p_token) < 32 THEN RETURN false; END IF;
  RETURN sha256(convert_to(p_token, 'UTF8')) = sha256(convert_to(s, 'UTF8'));
END $$;

-- 6e. Purge de rétention (détails contact + événements). Compteurs et émissions conservés.
CREATE OR REPLACE FUNCTION public.tyre_rpt_purge(p_days integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d integer; ne integer; nc integer;
BEGIN
  SELECT coalesce(p_days, retention_days, 30) INTO d FROM public.tyre_rpt_settings WHERE id = 1;
  d := greatest(coalesce(d, 30), 7);
  DELETE FROM public.tyre_rpt_events WHERE occurred_at < now() - make_interval(days => d);
  GET DIAGNOSTICS ne = ROW_COUNT;
  DELETE FROM public.tyre_rpt_contact_log WHERE created_at < now() - make_interval(days => d);
  GET DIAGNOSTICS nc = ROW_COUNT;
  UPDATE public.tyre_rpt_daily_reports SET snapshot_html = NULL, snapshot_csv = NULL, snapshot_subject = NULL
   WHERE report_date < (now() - make_interval(days => d))::date AND snapshot_html IS NOT NULL;
  RETURN jsonb_build_object('retention_days', d, 'events_deleted', ne, 'contacts_deleted', nc);
END $$;

REVOKE ALL ON FUNCTION public.tyre_rpt_contact_begin(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tyre_rpt_contact_finish(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tyre_rpt_claim_report(date, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tyre_rpt_verify_cron_token(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tyre_rpt_purge(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tyre_rpt_settings_stamp() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tyre_rpt_contact_begin(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.tyre_rpt_contact_finish(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.tyre_rpt_claim_report(date, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.tyre_rpt_verify_cron_token(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.tyre_rpt_purge(integer) TO service_role;

-- 7. Secret dédié, généré dans Vault (valeur jamais affichée ni retournée).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'tyre_reporting_cron_token') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'tyre_reporting_cron_token',
      'Bearer du planificateur DDA Pneus reporting (lecture service_role uniquement)');
  END IF;
END $$;

-- =====================================================================
-- PHASE 2 — NE PAS EXÉCUTER avant revue. Tâches planifiées (noms dédiés,
-- aucune tâche DDA existante modifiée). Le jeton est lu depuis Vault au
-- moment de l'appel : il n'apparaît dans aucun texte SQL ni sortie.
-- =====================================================================
-- SELECT cron.schedule('dda-tyres-reporting-daily', '0 * * * *', $job$
--   SELECT net.http_post(
--     url := 'https://ddaconnectv2.lovable.app/api/public/tyres/reporting-daily',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
--       'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'tyre_reporting_cron_token')),
--     body := '{}'::jsonb, timeout_milliseconds := 60000);
-- $job$);
-- SELECT cron.schedule('dda-tyres-reporting-purge', '30 2 * * *', $job$ SELECT public.tyre_rpt_purge(NULL); $job$);
--
-- Activation (après revue) :
-- UPDATE public.tyre_rpt_settings SET contact_log_enabled = true, events_enabled = true, report_enabled = true,
--   test_emails = ARRAY['…'], test_email_domains = ARRAY['…'] WHERE id = 1;
-- Désactivation : passer les trois booléens à false ; SELECT cron.unschedule('dda-tyres-reporting-daily');
