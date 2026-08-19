ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS code text;
CREATE UNIQUE INDEX IF NOT EXISTS sites_code_key ON public.sites(code) WHERE code IS NOT NULL;

UPDATE public.sites SET code = 'castillon' WHERE code IS NULL AND name ILIKE '%castillon%';
UPDATE public.sites SET code = 'dda' WHERE code IS NULL AND (name ILIKE '%lalinde%' OR name ILIKE '%digoin%');

INSERT INTO public.sites (code, name, legal_name, city)
SELECT 'castillon', 'Castillon', 'Garage Castillon Veyssière', 'St Cyprien'
WHERE NOT EXISTS (SELECT 1 FROM public.sites WHERE code = 'castillon');

INSERT INTO public.sites (code, name, legal_name, city)
SELECT 'dda', 'DDA / Lalinde', 'Damien Digoin Automobile', 'Lalinde'
WHERE NOT EXISTS (SELECT 1 FROM public.sites WHERE code = 'dda');

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS site_scope text NOT NULL DEFAULT 'site',
  ADD COLUMN IF NOT EXISTS gmail_allowed boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.email_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  address text NOT NULL,
  label text,
  provider text NOT NULL DEFAULT 'gmail',
  status text NOT NULL DEFAULT 'disconnected',
  last_sync_at timestamptz,
  last_error text,
  history_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (address)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_accounts TO authenticated;
GRANT ALL ON public.email_accounts TO service_role;
ALTER TABLE public.email_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_accounts_read" ON public.email_accounts FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "email_accounts_write" ON public.email_accounts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager') OR user_id = auth.uid())
  WITH CHECK (public.has_role(auth.uid(), 'manager') OR user_id = auth.uid());
CREATE TRIGGER trg_email_accounts_updated BEFORE UPDATE ON public.email_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL UNIQUE,
  rfc_message_id text,
  gmail_thread_id text,
  thread_key text,
  sent_at timestamptz NOT NULL,
  from_address text NOT NULL,
  from_name text,
  to_addresses text[] NOT NULL DEFAULT '{}',
  cc_addresses text[] NOT NULL DEFAULT '{}',
  subject text,
  snippet text,
  body_text text,
  body_html text,
  kind text NOT NULL DEFAULT 'message',
  category text NOT NULL DEFAULT 'autre',
  category_confidence numeric NOT NULL DEFAULT 0,
  category_source text NOT NULL DEFAULT 'auto',
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  has_attachments boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS emails_sent_at_idx ON public.emails(sent_at DESC);
CREATE INDEX IF NOT EXISTS emails_category_idx ON public.emails(category);
CREATE INDEX IF NOT EXISTS emails_thread_idx ON public.emails(thread_key);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.emails TO authenticated;
GRANT ALL ON public.emails TO service_role;
ALTER TABLE public.emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "emails_read" ON public.emails FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "emails_write" ON public.emails FOR ALL TO authenticated
  USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));
CREATE TRIGGER trg_emails_updated BEFORE UPDATE ON public.emails
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.email_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id uuid NOT NULL REFERENCES public.emails(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.email_accounts(id) ON DELETE SET NULL,
  mailbox_address text NOT NULL,
  person_name text,
  gmail_message_id text,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email_id, mailbox_address)
);
CREATE INDEX IF NOT EXISTS email_receipts_email_idx ON public.email_receipts(email_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_receipts TO authenticated;
GRANT ALL ON public.email_receipts TO service_role;
ALTER TABLE public.email_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_receipts_read" ON public.email_receipts FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "email_receipts_write" ON public.email_receipts FOR ALL TO authenticated
  USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));

CREATE TABLE IF NOT EXISTS public.email_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id uuid NOT NULL REFERENCES public.emails(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime_type text,
  size_bytes integer,
  storage_path text,
  gmail_attachment_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_attachments_email_idx ON public.email_attachments(email_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_attachments TO authenticated;
GRANT ALL ON public.email_attachments TO service_role;
ALTER TABLE public.email_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_attachments_read" ON public.email_attachments FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "email_attachments_write" ON public.email_attachments FOR ALL TO authenticated
  USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));