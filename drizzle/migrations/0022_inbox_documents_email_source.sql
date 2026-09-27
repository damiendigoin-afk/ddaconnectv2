ALTER TABLE public.inbox_documents ADD COLUMN IF NOT EXISTS source_email_id uuid REFERENCES public.emails(id) ON DELETE SET NULL;
ALTER TABLE public.inbox_documents ADD COLUMN IF NOT EXISTS source_email_attachment_id uuid REFERENCES public.email_attachments(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inbox_documents_source_attachment_uniq ON public.inbox_documents(source_email_attachment_id) WHERE source_email_attachment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inbox_documents_source_email_idx ON public.inbox_documents(source_email_id) WHERE source_email_id IS NOT NULL;