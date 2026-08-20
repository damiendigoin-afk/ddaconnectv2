-- 1. Retours : workflow complet
ALTER TABLE public.part_returns
  ADD COLUMN IF NOT EXISTS return_type text NOT NULL DEFAULT 'classique',
  ADD COLUMN IF NOT EXISTS document_kind text,
  ADD COLUMN IF NOT EXISTS bl_number text,
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS document_date date,
  ADD COLUMN IF NOT EXISTS document_path text,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS deposit_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accord_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS accord_status text,
  ADD COLUMN IF NOT EXISTS accord_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS accord_comment text,
  ADD COLUMN IF NOT EXISTS accord_refusal_reason text,
  ADD COLUMN IF NOT EXISTS handover_mode text,
  ADD COLUMN IF NOT EXISTS handover_person text,
  ADD COLUMN IF NOT EXISTS handover_company text,
  ADD COLUMN IF NOT EXISTS handover_place text,
  ADD COLUMN IF NOT EXISTS handover_at timestamptz,
  ADD COLUMN IF NOT EXISTS handover_note text,
  ADD COLUMN IF NOT EXISTS shipment_mail_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reception_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS reception_status text,
  ADD COLUMN IF NOT EXISTS reception_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reception_comment text,
  ADD COLUMN IF NOT EXISTS reminder_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_reason text,
  ADD COLUMN IF NOT EXISTS closure_reason text,
  ADD COLUMN IF NOT EXISTS closure_comment text,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by_name text,
  ADD COLUMN IF NOT EXISTS share_token text,
  ADD COLUMN IF NOT EXISTS share_enabled boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS part_returns_share_token_key ON public.part_returns (share_token) WHERE share_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS part_returns_supplier_idx ON public.part_returns (supplier_id);
CREATE INDEX IF NOT EXISTS part_returns_status_idx ON public.part_returns (status);

-- 2. Lignes : détection assistée
ALTER TABLE public.part_return_lines
  ADD COLUMN IF NOT EXISTS confidence text,
  ADD COLUMN IF NOT EXISTS annotation_hint text,
  ADD COLUMN IF NOT EXISTS suggested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS discount numeric,
  ADD COLUMN IF NOT EXISTS line_total numeric,
  ADD COLUMN IF NOT EXISTS deposit_amount numeric;

-- 3. Fournisseurs : règles de relance
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS reminders_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS first_reminder_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS reminder_interval_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS max_reminders integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS reception_confirm_days integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS default_carrier text,
  ADD COLUMN IF NOT EXISTS escalation_email text;

-- 4. Chronologie
CREATE TABLE IF NOT EXISTS public.return_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.part_returns(id) ON DELETE CASCADE,
  kind text NOT NULL,
  detail text,
  payload jsonb,
  actor_id uuid,
  actor_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS return_events_return_idx ON public.return_events (return_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.return_events TO authenticated;
GRANT ALL ON public.return_events TO service_role;
ALTER TABLE public.return_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "return_events_read" ON public.return_events FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "return_events_write" ON public.return_events FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));

-- 5. Documents du dossier
CREATE TABLE IF NOT EXISTS public.return_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.part_returns(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'autre',
  filename text,
  storage_path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  source text NOT NULL DEFAULT 'interne',
  uploaded_by uuid,
  uploaded_by_name text,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS return_documents_return_idx ON public.return_documents (return_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.return_documents TO authenticated;
GRANT ALL ON public.return_documents TO service_role;
ALTER TABLE public.return_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "return_documents_read" ON public.return_documents FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "return_documents_write" ON public.return_documents FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "return_documents_update" ON public.return_documents FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "return_documents_delete" ON public.return_documents FOR DELETE TO authenticated USING (public.is_active_user(auth.uid()));