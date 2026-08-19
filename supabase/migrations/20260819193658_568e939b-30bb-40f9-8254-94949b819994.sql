CREATE TABLE public.email_oauth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES public.email_accounts(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'gmail',
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.email_oauth_tokens TO service_role;

ALTER TABLE public.email_oauth_tokens ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_email_tokens_updated BEFORE UPDATE ON public.email_oauth_tokens
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.email_accounts ADD COLUMN IF NOT EXISTS sync_cursor text;
ALTER TABLE public.email_accounts ADD COLUMN IF NOT EXISTS last_sync_count integer NOT NULL DEFAULT 0;