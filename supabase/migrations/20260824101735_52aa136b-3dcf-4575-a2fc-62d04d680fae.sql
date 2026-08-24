CREATE OR REPLACE FUNCTION public.enforce_single_inspection_per_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.repair_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.repair_order_id IS NOT DISTINCT FROM OLD.repair_order_id THEN
    RETURN NEW;
  END IF;

  -- Sérialise les créations concurrentes sur un même dossier (double clic, deux appareils).
  PERFORM pg_advisory_xact_lock(hashtext('vehicle_inspection_order:' || NEW.repair_order_id::text));

  IF EXISTS (
    SELECT 1 FROM public.vehicle_inspections v
    WHERE v.repair_order_id = NEW.repair_order_id
      AND v.id <> NEW.id
      AND v.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Un Tour Véhicule existe déjà pour ce dossier'
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_single_inspection_per_order ON public.vehicle_inspections;
CREATE TRIGGER enforce_single_inspection_per_order
BEFORE INSERT OR UPDATE OF repair_order_id ON public.vehicle_inspections
FOR EACH ROW EXECUTE FUNCTION public.enforce_single_inspection_per_order();

REVOKE EXECUTE ON FUNCTION public.enforce_single_inspection_per_order() FROM PUBLIC, anon, authenticated;