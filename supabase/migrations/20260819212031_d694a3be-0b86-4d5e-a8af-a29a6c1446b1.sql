GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_accounts TO authenticated;
GRANT ALL ON public.email_accounts TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.emails TO authenticated;
GRANT ALL ON public.emails TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_receipts TO authenticated;
GRANT ALL ON public.email_receipts TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_attachments TO authenticated;
GRANT ALL ON public.email_attachments TO service_role;

REVOKE ALL ON public.email_oauth_tokens FROM anon, authenticated;
GRANT ALL ON public.email_oauth_tokens TO service_role;