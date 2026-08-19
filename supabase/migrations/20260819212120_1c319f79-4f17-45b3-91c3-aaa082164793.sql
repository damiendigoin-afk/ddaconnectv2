REVOKE ALL ON public.email_accounts FROM PUBLIC, anon;
REVOKE ALL ON public.emails FROM PUBLIC, anon;
REVOKE ALL ON public.email_receipts FROM PUBLIC, anon;
REVOKE ALL ON public.email_attachments FROM PUBLIC, anon;
REVOKE ALL ON public.email_oauth_tokens FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_accounts TO authenticated;
GRANT ALL ON public.email_accounts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.emails TO authenticated;
GRANT ALL ON public.emails TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_receipts TO authenticated;
GRANT ALL ON public.email_receipts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_attachments TO authenticated;
GRANT ALL ON public.email_attachments TO service_role;
GRANT ALL ON public.email_oauth_tokens TO service_role;

DROP POLICY IF EXISTS "email_oauth_tokens_server_only" ON public.email_oauth_tokens;
CREATE POLICY "email_oauth_tokens_server_only"
ON public.email_oauth_tokens
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);