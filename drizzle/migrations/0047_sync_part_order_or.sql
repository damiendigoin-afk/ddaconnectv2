-- Chaînage commande -> OR atelier : repère OR texte converti en vrai rattachement, pièces reçues affectées « à pointer ». Idempotent.
CREATE OR REPLACE FUNCTION public.sync_part_order_or(_order uuid, _user_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o record; rid uuid; rl record; q numeric; avail numeric; mv uuid; n int := 0;
BEGIN
  SELECT * INTO o FROM part_orders WHERE id = _order FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF auth.uid() IS NOT NULL AND NOT (is_active_user(auth.uid()) AND user_can_access_site(auth.uid(), o.site_id)) THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;
  IF o.status = 'cancelled' OR o.destination <> 'or' THEN RETURN jsonb_build_object('ok', true, 'linked', false); END IF;
  rid := o.repair_order_id;
  IF rid IS NULL THEN
    rid := resolve_or_for_order(o.site_id, o.requested_or_number, o.plate);
    IF rid IS NULL THEN RETURN jsonb_build_object('ok', true, 'linked', false, 'reason', 'or_absent_ou_ambigu'); END IF;
    UPDATE part_orders SET repair_order_id = rid WHERE id = _order AND repair_order_id IS NULL;
  END IF;
  UPDATE part_order_lines SET repair_order_id = rid WHERE order_id = _order AND repair_order_id IS NULL
    AND (requested_or_number IS NULL OR norm_or_number(requested_or_number) = norm_or_number(o.requested_or_number));
  UPDATE part_receipts SET repair_order_id = rid WHERE order_id = _order AND repair_order_id IS NULL AND coalesce(status,'') <> 'cancelled';
  FOR rl IN
    SELECT l.* FROM part_receipt_lines l
      JOIN part_receipts r ON r.id = l.receipt_id
      LEFT JOIN part_order_lines ol ON ol.id = l.order_line_id
     WHERE r.order_id = _order AND coalesce(r.status,'') <> 'cancelled'
       AND l.article_id IS NOT NULL AND l.qty_received > 0 AND coalesce(l.condition,'usable') = 'usable'
       AND (ol.id IS NULL OR ol.repair_order_id = rid)
       AND NOT EXISTS (SELECT 1 FROM or_part_usage u WHERE u.receipt_line_id = l.id)
     FOR UPDATE OF l
  LOOP
    q := rl.qty_received - coalesce(rl.qty_allocated, 0);
    IF q <= 0 THEN CONTINUE; END IF;
    SELECT coalesce(sum(delta_available), 0) INTO avail FROM stock_movements WHERE article_id = rl.article_id AND site_id = o.site_id;
    IF avail < q THEN CONTINUE; END IF;  -- pièce déjà sortie : pas d'affectation forcée
    INSERT INTO stock_movements (site_id, article_id, movement_type, qty, delta_available, delta_allocated, repair_order_id, receipt_line_id, reason, created_by_name)
      VALUES (o.site_id, rl.article_id, 'allocate_to_or', q, -q, q, rid, rl.id, 'Affectation automatique commande → OR', _user_name)
      RETURNING id INTO mv;
    INSERT INTO or_part_usage (repair_order_id, site_id, article_id, receipt_line_id, movement_id, item_kind, physical_reference, designation, qty_allocated, usage_status, created_by_name)
      VALUES (rid, o.site_id, rl.article_id, rl.id, mv, 'part', rl.physical_reference, rl.designation, q, 'pending', _user_name);
    UPDATE part_receipt_lines SET repair_order_id = rid, destination = 'or', qty_allocated = coalesce(qty_allocated, 0) + q WHERE id = rl.id;
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'linked', true, 'repair_order_id', rid, 'allocated', n);
END $$;

CREATE OR REPLACE FUNCTION public.sync_or_part_orders(_or uuid, _user_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; o record; n int := 0;
BEGIN
  SELECT * INTO r FROM repair_orders WHERE id = _or;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false); END IF;
  IF auth.uid() IS NOT NULL AND NOT (is_active_user(auth.uid()) AND user_can_access_site(auth.uid(), r.site_id)) THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;
  FOR o IN SELECT id FROM part_orders WHERE site_id = r.site_id AND status <> 'cancelled' AND destination = 'or'
     AND (repair_order_id = _or OR (repair_order_id IS NULL AND norm_or_number(requested_or_number) = norm_or_number(r.or_number)))
  LOOP
    PERFORM sync_part_order_or(o.id, _user_name); n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'orders', n);
END $$;

REVOKE EXECUTE ON FUNCTION public.sync_part_order_or(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_or_part_orders(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_part_order_or(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_or_part_orders(uuid, text) TO authenticated, service_role;