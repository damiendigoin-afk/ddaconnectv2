CREATE OR REPLACE FUNCTION public.norm_or_number(_v text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT nullif(ltrim(regexp_replace(upper(coalesce(_v,'')),'[^A-Z0-9]','','g'),'0'),'') $$;
CREATE OR REPLACE FUNCTION public.norm_plate_key(_v text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT nullif(regexp_replace(upper(coalesce(_v,'')),'[^A-Z0-9]','','g'),'') $$;

-- OR unique et non contradictoire pour (site, n° OR) ; NULL si absent ou ambigu.
CREATE OR REPLACE FUNCTION public.resolve_or_for_order(_site uuid, _or text, _plate text) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _ids uuid[]; _vplate text;
BEGIN
  IF _site IS NULL OR norm_or_number(_or) IS NULL THEN RETURN NULL; END IF;
  SELECT array_agg(r.id) INTO _ids FROM repair_orders r
   WHERE r.site_id = _site AND norm_or_number(r.or_number) = norm_or_number(_or) AND coalesce(r.status,'') <> 'cancelled';
  IF coalesce(array_length(_ids,1),0) <> 1 THEN RETURN NULL; END IF;
  SELECT v.plate INTO _vplate FROM repair_orders r LEFT JOIN vehicles v ON v.id = r.vehicle_id WHERE r.id = _ids[1];
  IF norm_plate_key(_plate) IS NOT NULL AND norm_plate_key(_vplate) IS NOT NULL AND norm_plate_key(_plate) <> norm_plate_key(_vplate) THEN RETURN NULL; END IF;
  RETURN _ids[1];
END $$;

-- Commande saisie après le dossier.
CREATE OR REPLACE FUNCTION public.trg_part_order_link_or() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.repair_order_id IS NULL AND NEW.destination = 'or' AND NEW.status <> 'cancelled' AND NEW.requested_or_number IS NOT NULL THEN
    NEW.repair_order_id := resolve_or_for_order(NEW.site_id, NEW.requested_or_number, NEW.plate);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_part_orders_link_or ON public.part_orders;
CREATE TRIGGER trg_part_orders_link_or BEFORE INSERT OR UPDATE OF requested_or_number, plate, site_id ON public.part_orders FOR EACH ROW EXECUTE FUNCTION public.trg_part_order_link_or();

CREATE OR REPLACE FUNCTION public.trg_part_order_lines_follow() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.repair_order_id IS NOT NULL AND (OLD.repair_order_id IS NULL OR TG_OP = 'INSERT') THEN
    UPDATE part_order_lines SET repair_order_id = NEW.repair_order_id
     WHERE order_id = NEW.id AND repair_order_id IS NULL
       AND (requested_or_number IS NULL OR norm_or_number(requested_or_number) = norm_or_number(NEW.requested_or_number));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_part_orders_lines_follow ON public.part_orders;
CREATE TRIGGER trg_part_orders_lines_follow AFTER UPDATE OF repair_order_id ON public.part_orders FOR EACH ROW EXECUTE FUNCTION public.trg_part_order_lines_follow();

-- Dossier créé/scanné après la commande.
CREATE OR REPLACE FUNCTION public.trg_repair_order_link_orders() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o record;
BEGIN
  IF norm_or_number(NEW.or_number) IS NULL THEN RETURN NULL; END IF;
  FOR o IN SELECT id, site_id, requested_or_number, plate FROM part_orders
    WHERE site_id = NEW.site_id AND repair_order_id IS NULL AND destination = 'or' AND status <> 'cancelled'
      AND norm_or_number(requested_or_number) = norm_or_number(NEW.or_number)
  LOOP
    IF resolve_or_for_order(o.site_id, o.requested_or_number, o.plate) = NEW.id THEN
      UPDATE part_orders SET repair_order_id = NEW.id WHERE id = o.id AND repair_order_id IS NULL;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_repair_orders_link_orders ON public.repair_orders;
CREATE TRIGGER trg_repair_orders_link_orders AFTER INSERT OR UPDATE OF or_number, vehicle_id, site_id ON public.repair_orders FOR EACH ROW EXECUTE FUNCTION public.trg_repair_order_link_orders();

-- Correction ciblée du cas réel (OR 50888 / ET-875-QJ), seulement si non ambigu.
UPDATE public.part_orders SET repair_order_id = 'bcf1c7af-5058-4942-b5cf-36c6d0b61568'
 WHERE id = '644fa667-d760-4589-9cec-e3741071e4e0' AND repair_order_id IS NULL
   AND public.resolve_or_for_order(site_id, requested_or_number, plate) = 'bcf1c7af-5058-4942-b5cf-36c6d0b61568';