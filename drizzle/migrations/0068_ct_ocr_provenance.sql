ALTER TABLE public.inspection_points
  ADD COLUMN IF NOT EXISTS ct_ocr_date date,
  ADD COLUMN IF NOT EXISTS ct_ocr_meta jsonb;