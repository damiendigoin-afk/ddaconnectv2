CREATE OR REPLACE FUNCTION public.part_order_target(_ro uuid, _or text, _plate text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(
    'ro:' || _ro::text,
    NULLIF('or:' || upper(btrim(COALESCE(_or, ''))), 'or:'),
    NULLIF('plate:' || upper(regexp_replace(COALESCE(_plate, ''), '[^A-Za-z0-9]', '', 'g')), 'plate:'),
    'none')
$$;

CREATE OR REPLACE FUNCTION public.guard_part_order_duplicate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _target text := public.part_order_target(NEW.repair_order_id, NEW.requested_or_number, NEW.plate);
  _ref text := NULLIF(btrim(COALESCE(NEW.supplier_order_ref, '')), '');
  _existing uuid;
BEGIN
  IF NEW.status = 'cancelled' OR (NEW.source_document_id IS NULL AND (_ref IS NULL OR NEW.supplier_id IS NULL)) THEN
    RETURN NEW;
  END IF;
  -- Sérialise les insertions concurrentes pour une même cible sur un même site.
  PERFORM pg_advisory_xact_lock(hashtext('part_order:' || NEW.site_id::text || ':' || COALESCE(NEW.destination, '') || ':' || _target));
  SELECT o.id INTO _existing FROM public.part_orders o
  WHERE o.site_id = NEW.site_id
    AND o.status <> 'cancelled'
    AND o.destination IS NOT DISTINCT FROM NEW.destination
    AND public.part_order_target(o.repair_order_id, o.requested_or_number, o.plate) = _target
    AND (
      (NEW.source_document_id IS NOT NULL AND o.source_document_id = NEW.source_document_id)
      OR (_ref IS NOT NULL AND NEW.supplier_id IS NOT NULL AND o.supplier_id = NEW.supplier_id
          AND NULLIF(btrim(COALESCE(o.supplier_order_ref, '')), '') = _ref)
    )
  ORDER BY o.created_at LIMIT 1;
  IF _existing IS NOT NULL THEN
    RAISE EXCEPTION 'DUPLICATE_PART_ORDER:%', _existing USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_part_order_duplicate ON public.part_orders;
CREATE TRIGGER trg_guard_part_order_duplicate BEFORE INSERT ON public.part_orders
FOR EACH ROW EXECUTE FUNCTION public.guard_part_order_duplicate();