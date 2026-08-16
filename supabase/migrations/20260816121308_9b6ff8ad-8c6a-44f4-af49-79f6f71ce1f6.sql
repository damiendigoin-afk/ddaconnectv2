ALTER TABLE public.part_returns
  ADD COLUMN IF NOT EXISTS photos text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS analysis jsonb;

ALTER TABLE public.import_rows
  ADD COLUMN IF NOT EXISTS corrected_data jsonb,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS import_rows_status_idx ON public.import_rows (import_id, processing_status);