ALTER TABLE public.inspection_points ADD COLUMN IF NOT EXISTS client_comment text;
ALTER TABLE public.observations ADD COLUMN IF NOT EXISTS client_comment text;
ALTER TABLE public.vehicle_inspections ADD COLUMN IF NOT EXISTS client_content_updated_at timestamptz;
ALTER TABLE public.vehicle_inspections ADD COLUMN IF NOT EXISTS last_sent_at timestamptz;
ALTER TABLE public.vehicle_inspections ADD COLUMN IF NOT EXISTS last_sent_to text;

CREATE TABLE IF NOT EXISTS public.email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid REFERENCES public.vehicle_inspections(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  subject text,
  kind text NOT NULL DEFAULT 'rapport_client',
  status text NOT NULL DEFAULT 'pending',
  provider_id text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_logs TO anon;
GRANT ALL ON public.email_logs TO service_role;

ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS open_email_logs ON public.email_logs;
CREATE POLICY open_email_logs ON public.email_logs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS email_logs_inspection_idx ON public.email_logs(inspection_id, created_at DESC);