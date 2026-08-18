ALTER TABLE public.vehicle_inspections
  ALTER COLUMN started_at DROP NOT NULL,
  ALTER COLUMN started_at DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS started_by uuid,
  ADD COLUMN IF NOT EXISTS started_by_name text,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS control_type text;

UPDATE public.vehicle_inspections
SET finished_at = completed_at
WHERE finished_at IS NULL AND completed_at IS NOT NULL;

ALTER TABLE public.inspection_points
  ADD COLUMN IF NOT EXISTS ct_due_date date,
  ADD COLUMN IF NOT EXISTS pollution_due_date date,
  ADD COLUMN IF NOT EXISTS ct_read_at timestamptz,
  ADD COLUMN IF NOT EXISTS ct_source text,
  ADD COLUMN IF NOT EXISTS ct_manually_corrected boolean NOT NULL DEFAULT false;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS ct_due_date date,
  ADD COLUMN IF NOT EXISTS pollution_due_date date,
  ADD COLUMN IF NOT EXISTS ct_read_at timestamptz,
  ADD COLUMN IF NOT EXISTS ct_source text,
  ADD COLUMN IF NOT EXISTS ct_photo_media_id uuid REFERENCES public.media(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ct_manually_corrected boolean NOT NULL DEFAULT false;

ALTER TABLE public.ref_vehicles
  ADD COLUMN IF NOT EXISTS ct_due_date date,
  ADD COLUMN IF NOT EXISTS pollution_due_date date,
  ADD COLUMN IF NOT EXISTS ct_read_at timestamptz,
  ADD COLUMN IF NOT EXISTS ct_source text,
  ADD COLUMN IF NOT EXISTS ct_photo_media_id uuid REFERENCES public.media(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ct_manually_corrected boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.start_vehicle_inspection(
  _inspection_id uuid,
  _user_id uuid,
  _user_name text
)
RETURNS public.vehicle_inspections
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row public.vehicle_inspections;
BEGIN
  UPDATE public.vehicle_inspections
     SET started_at = COALESCE(started_at, now()),
         started_by = COALESCE(started_by, _user_id),
         started_by_name = COALESCE(started_by_name, NULLIF(_user_name, '')),
         control_type = COALESCE(control_type, inspection_type),
         updated_at = now()
   WHERE id = _inspection_id
   RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Tour véhicule introuvable';
  END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_vehicle_inspection(
  _inspection_id uuid,
  _user_id uuid,
  _user_name text
)
RETURNS public.vehicle_inspections
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_row public.vehicle_inspections;
BEGIN
  UPDATE public.vehicle_inspections
     SET status = 'completed',
         completed_at = v_now,
         finished_at = v_now,
         duration_seconds = CASE
           WHEN started_at IS NULL THEN NULL
           ELSE GREATEST(0, floor(extract(epoch FROM (v_now - started_at)))::integer)
         END,
         completed_by = _user_id,
         completed_by_name = NULLIF(_user_name, ''),
         control_type = COALESCE(control_type, inspection_type),
         updated_at = v_now
   WHERE id = _inspection_id
   RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Tour véhicule introuvable';
  END IF;
  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_vehicle_inspection(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_vehicle_inspection(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_vehicle_inspection(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_vehicle_inspection(uuid, uuid, text) TO service_role;