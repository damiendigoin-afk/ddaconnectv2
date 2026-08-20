CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

ALTER TABLE public.email_accounts
  ADD COLUMN IF NOT EXISTS backfill_page_token text,
  ADD COLUMN IF NOT EXISTS backfill_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz;