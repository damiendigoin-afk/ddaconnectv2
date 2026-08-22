ALTER TABLE public.repair_orders
  ADD COLUMN IF NOT EXISTS internal_ref text,
  ADD COLUMN IF NOT EXISTS or_status text NOT NULL DEFAULT 'or_manquant';

DO $$ BEGIN
  ALTER TABLE public.repair_orders
    ADD CONSTRAINT repair_orders_or_status_check CHECK (or_status IN ('or_manquant','or_complet'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS repair_orders_internal_ref_key ON public.repair_orders (internal_ref) WHERE internal_ref IS NOT NULL;

UPDATE public.repair_orders SET or_status = 'or_complet' WHERE or_number IS NOT NULL AND btrim(or_number) <> '' AND or_status <> 'or_complet';

CREATE SEQUENCE IF NOT EXISTS public.dda_order_ref_seq;
GRANT USAGE, SELECT ON SEQUENCE public.dda_order_ref_seq TO authenticated;
GRANT ALL ON SEQUENCE public.dda_order_ref_seq TO service_role;

CREATE OR REPLACE FUNCTION public.next_dda_order_ref()
RETURNS text
LANGUAGE sql
SET search_path TO 'public'
AS $function$
  SELECT 'DDA-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.dda_order_ref_seq')::text, 5, '0')
$function$;

ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS importance text NOT NULL DEFAULT 'normale',
  ADD COLUMN IF NOT EXISTS urgency text NOT NULL DEFAULT 'aucune',
  ADD COLUMN IF NOT EXISTS action_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS human_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS services text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS triage_status text NOT NULL DEFAULT 'a_qualifier',
  ADD COLUMN IF NOT EXISTS triage_confidence text NOT NULL DEFAULT 'faible',
  ADD COLUMN IF NOT EXISTS triage_reason text;

DO $$ BEGIN
  ALTER TABLE public.emails ADD CONSTRAINT emails_importance_check CHECK (importance IN ('faible','normale','forte'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.emails ADD CONSTRAINT emails_urgency_check CHECK (urgency IN ('aucune','faible','moyenne','haute','immediate'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.emails ADD CONSTRAINT emails_triage_status_check CHECK (triage_status IN ('a_qualifier','a_traiter','en_cours','traite','sans_suite'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.emails ADD CONSTRAINT emails_triage_confidence_check CHECK (triage_confidence IN ('faible','moyenne','forte'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS emails_triage_status_idx ON public.emails (triage_status, due_at);