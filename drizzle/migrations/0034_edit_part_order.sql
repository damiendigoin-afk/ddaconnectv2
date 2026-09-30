ALTER TABLE public.part_order_lines
  ADD COLUMN IF NOT EXISTS repair_order_id uuid REFERENCES public.repair_orders(id),
  ADD COLUMN IF NOT EXISTS requested_or_number text;
COMMENT ON COLUMN public.part_order_lines.repair_order_id IS 'OR propre à la ligne (NULL = OR de la commande)';

CREATE OR REPLACE FUNCTION public.update_part_order(_order uuid, _head jsonb, _lines jsonb, _user_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o public.part_orders%ROWTYPE;
  before_head jsonb; before_lines jsonb; after_lines jsonb;
  l jsonb; cur public.part_order_lines%ROWTYPE;
  lid uuid; keep uuid[] := '{}'; n_upd int := 0; n_ins int := 0; n_del int := 0;
  invoiced boolean; qty numeric; ref text; kind text; any_rec boolean;
  warnings text[] := '{}';
BEGIN
  SELECT * INTO o FROM public.part_orders WHERE id = _order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable'; END IF;
  IF NOT (is_active_user(auth.uid()) AND user_can_access_site(auth.uid(), o.site_id)
          AND (has_role(auth.uid(), 'manager') OR EXISTS (SELECT 1 FROM user_module_access a WHERE a.user_id = auth.uid() AND a.allowed AND a.module_key = 'magasin'))) THEN
    RAISE EXCEPTION 'Accès refusé : commande hors de votre périmètre';
  END IF;
  IF o.status = 'cancelled' THEN RAISE EXCEPTION 'Commande annulée : modification impossible'; END IF;
  IF _head ? 'destination' AND (_head->>'destination') NOT IN ('or','stock','store_sale') THEN RAISE EXCEPTION 'Destination invalide'; END IF;

  SELECT EXISTS (SELECT 1 FROM part_receipts r WHERE r.order_id = _order AND coalesce(r.status,'') <> 'cancelled') INTO any_rec;
  before_head := jsonb_build_object('supplier_id', o.supplier_id, 'supplier_order_ref', o.supplier_order_ref, 'order_date', o.order_date, 'comment', o.comment,
    'destination', o.destination, 'repair_order_id', o.repair_order_id, 'vehicle_id', o.vehicle_id, 'plate', o.plate, 'requested_or_number', o.requested_or_number);
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at), '[]') INTO before_lines FROM part_order_lines x WHERE x.order_id = _order;

  IF any_rec AND _head ? 'repair_order_id' AND (_head->>'repair_order_id') IS DISTINCT FROM o.repair_order_id::text THEN
    warnings := warnings || 'Pièces déjà reçues : leurs affectations restent sur l''OR d''origine.';
  END IF;
  IF any_rec AND _head ? 'destination' AND (_head->>'destination') IS DISTINCT FROM o.destination THEN
    warnings := warnings || 'Destination : appliquée aux prochaines réceptions uniquement.';
  END IF;

  UPDATE part_orders SET
    supplier_id = CASE WHEN _head ? 'supplier_id' THEN nullif(_head->>'supplier_id','')::uuid ELSE supplier_id END,
    supplier_order_ref = CASE WHEN _head ? 'supplier_order_ref' THEN nullif(trim(_head->>'supplier_order_ref'),'') ELSE supplier_order_ref END,
    order_date = CASE WHEN _head ? 'order_date' THEN nullif(_head->>'order_date','')::date ELSE order_date END,
    comment = CASE WHEN _head ? 'comment' THEN nullif(trim(_head->>'comment'),'') ELSE comment END,
    destination = CASE WHEN _head ? 'destination' THEN _head->>'destination' ELSE destination END,
    repair_order_id = CASE WHEN _head ? 'repair_order_id' THEN nullif(_head->>'repair_order_id','')::uuid ELSE repair_order_id END,
    vehicle_id = CASE WHEN _head ? 'vehicle_id' THEN nullif(_head->>'vehicle_id','')::uuid ELSE vehicle_id END,
    plate = CASE WHEN _head ? 'plate' THEN nullif(trim(_head->>'plate'),'') ELSE plate END,
    requested_or_number = CASE WHEN _head ? 'requested_or_number' THEN nullif(trim(_head->>'requested_or_number'),'') ELSE requested_or_number END,
    updated_at = now()
  WHERE id = _order;

  IF _lines IS NOT NULL THEN
    FOR l IN SELECT * FROM jsonb_array_elements(_lines) LOOP
      qty := nullif(l->>'qty_ordered','')::numeric;
      ref := nullif(trim(coalesce(l->>'physical_reference','')),'');
      kind := coalesce(l->>'line_kind','part');
      IF kind NOT IN ('part','fee','deposit') THEN RAISE EXCEPTION 'Type de ligne invalide'; END IF;
      IF qty IS NOT NULL AND qty < 0 THEN RAISE EXCEPTION 'Quantité négative interdite'; END IF;
      IF nullif(l->>'id','') IS NOT NULL THEN
        SELECT * INTO cur FROM part_order_lines WHERE id = (l->>'id')::uuid AND order_id = _order FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Ligne étrangère à cette commande'; END IF;
        SELECT EXISTS (SELECT 1 FROM part_receipt_lines pl WHERE pl.order_line_id = cur.id
                  AND (pl.unit_cost_real IS NOT NULL OR EXISTS (SELECT 1 FROM supplier_cost_lines c WHERE c.receipt_line_id = pl.id AND c.status <> 'ignored'))) INTO invoiced;
        IF cur.qty_received > 0 OR invoiced THEN
          IF ref IS DISTINCT FROM cur.physical_reference OR kind <> cur.line_kind THEN
            RAISE EXCEPTION 'Ligne % déjà reçue/facturée : référence et type conservés (stock et facture liés). Corrigez via une régularisation.', coalesce(cur.physical_reference, cur.designation, '?');
          END IF;
          IF qty IS NOT NULL AND qty < cur.qty_received THEN
            RAISE EXCEPTION 'Ligne % : quantité commandée (%) inférieure à la quantité déjà reçue (%).', coalesce(cur.physical_reference,'?'), qty, cur.qty_received;
          END IF;
        END IF;
        UPDATE part_order_lines SET
          line_kind = kind, physical_reference = ref,
          designation = nullif(trim(coalesce(l->>'designation','')),''),
          qty_ordered = qty,
          expected_unit_cost_ht = nullif(l->>'expected_unit_cost_ht','')::numeric,
          repair_order_id = nullif(l->>'repair_order_id','')::uuid,
          requested_or_number = nullif(trim(coalesce(l->>'requested_or_number','')),''),
          status = CASE WHEN cur.status = 'cancelled' THEN 'cancelled'
                        WHEN cur.qty_received <= 0 THEN 'ordered'
                        WHEN qty IS NULL OR cur.qty_received >= qty THEN 'received' ELSE 'partial' END,
          updated_at = now()
        WHERE id = cur.id;
        keep := keep || cur.id; n_upd := n_upd + 1;
      ELSE
        IF ref IS NULL AND nullif(trim(coalesce(l->>'designation','')),'') IS NULL THEN CONTINUE; END IF;
        INSERT INTO part_order_lines(order_id, line_kind, physical_reference, designation, qty_ordered, expected_unit_cost_ht, repair_order_id, requested_or_number)
        VALUES (_order, kind, ref, nullif(trim(coalesce(l->>'designation','')),''), qty, nullif(l->>'expected_unit_cost_ht','')::numeric,
                nullif(l->>'repair_order_id','')::uuid, nullif(trim(coalesce(l->>'requested_or_number','')),''))
        RETURNING id INTO lid;
        keep := keep || lid; n_ins := n_ins + 1;
      END IF;
    END LOOP;

    -- Suppressions : uniquement lignes non engagées (ni reçues, ni liées à une réception).
    IF EXISTS (SELECT 1 FROM part_order_lines x WHERE x.order_id = _order AND NOT (x.id = ANY(keep))
               AND (x.qty_received > 0 OR EXISTS (SELECT 1 FROM part_receipt_lines pl WHERE pl.order_line_id = x.id))) THEN
      RAISE EXCEPTION 'Une ligne déjà reçue ne peut pas être supprimée (mouvements de stock liés).';
    END IF;
    DELETE FROM part_order_lines x WHERE x.order_id = _order AND NOT (x.id = ANY(keep));
    GET DIAGNOSTICS n_del = ROW_COUNT;
  END IF;

  UPDATE part_orders p SET
    order_mode = CASE WHEN EXISTS (SELECT 1 FROM part_order_lines x WHERE x.order_id = _order) THEN 'detailed' ELSE p.order_mode END,
    status = CASE
      WHEN NOT EXISTS (SELECT 1 FROM part_order_lines x WHERE x.order_id = _order AND x.line_kind = 'part') THEN CASE WHEN any_rec THEN 'received' ELSE 'ordered' END
      WHEN NOT EXISTS (SELECT 1 FROM part_order_lines x WHERE x.order_id = _order AND x.line_kind = 'part' AND x.status <> 'received') THEN 'received'
      WHEN any_rec OR EXISTS (SELECT 1 FROM part_order_lines x WHERE x.order_id = _order AND x.line_kind = 'part' AND x.status <> 'ordered') THEN 'partial'
      ELSE 'ordered' END
  WHERE id = _order;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at), '[]') INTO after_lines FROM part_order_lines x WHERE x.order_id = _order;
  INSERT INTO parts_events(site_id, entity, entity_id, repair_order_id, action, detail, created_by, created_by_name)
  VALUES (o.site_id, 'part_order', _order, o.repair_order_id, 'manual_edit',
    jsonb_build_object('before', jsonb_build_object('head', before_head, 'lines', before_lines),
                       'after', jsonb_build_object('head', (SELECT jsonb_build_object('supplier_id', supplier_id, 'supplier_order_ref', supplier_order_ref, 'order_date', order_date, 'comment', comment, 'destination', destination, 'repair_order_id', repair_order_id, 'vehicle_id', vehicle_id, 'plate', plate, 'requested_or_number', requested_or_number) FROM part_orders WHERE id = _order), 'lines', after_lines),
                       'warnings', to_jsonb(warnings), 'at', now()),
    auth.uid(), _user_name);
  RETURN jsonb_build_object('updated', n_upd, 'inserted', n_ins, 'deleted', n_del, 'warnings', to_jsonb(warnings));
END $$;

REVOKE ALL ON FUNCTION public.update_part_order(uuid, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_part_order(uuid, jsonb, jsonb, text) TO authenticated;