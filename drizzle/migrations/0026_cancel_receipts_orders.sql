ALTER TABLE public.part_receipts
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancelled_by_name text,
  ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE public.part_orders
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancelled_by_name text,
  ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS reversal_of uuid REFERENCES public.stock_movements(id);
CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_reversal_of_uniq ON public.stock_movements(reversal_of) WHERE reversal_of IS NOT NULL;

CREATE OR REPLACE FUNCTION public.cancel_part_receipt(_receipt uuid, _reason text, _user_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.part_receipts%ROWTYPE;
  m record; l record; n_mv int := 0; n_lines int := 0;
  parts int; recv int; notordered int; anyrec boolean;
BEGIN
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN RAISE EXCEPTION 'Motif d''annulation obligatoire'; END IF;
  SELECT * INTO r FROM public.part_receipts WHERE id = _receipt FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Réception introuvable'; END IF;
  IF NOT (is_active_user(auth.uid()) AND user_can_access_site(auth.uid(), r.site_id)) THEN RAISE EXCEPTION 'Accès refusé à ce site'; END IF;
  IF r.status = 'cancelled' THEN RAISE EXCEPTION 'Réception déjà annulée'; END IF;

  -- Pièces déjà consommées / facturées / retournées : pas d'inversion automatique.
  IF EXISTS (SELECT 1 FROM stock_movements sm JOIN part_receipt_lines pl ON pl.id = sm.receipt_line_id
             WHERE pl.receipt_id = _receipt AND NOT sm.is_reversal
               AND sm.movement_type NOT IN ('receipt_in','damaged_quarantine','allocate_to_or')) THEN
    RAISE EXCEPTION 'Des pièces de cette réception ont déjà été utilisées, facturées ou retournées : annulation impossible, passez par une correction de stock.';
  END IF;
  IF EXISTS (SELECT 1 FROM or_part_usage u JOIN part_receipt_lines pl ON pl.id = u.receipt_line_id
             WHERE pl.receipt_id = _receipt AND u.usage_status <> 'pending') THEN
    RAISE EXCEPTION 'Des pièces de cette réception ont déjà été pointées comme utilisées sur l''OR : annulation impossible.';
  END IF;

  FOR m IN SELECT sm.* FROM stock_movements sm JOIN part_receipt_lines pl ON pl.id = sm.receipt_line_id
           WHERE pl.receipt_id = _receipt AND NOT sm.is_reversal
             AND NOT EXISTS (SELECT 1 FROM stock_movements x WHERE x.reversal_of = sm.id) LOOP
    INSERT INTO stock_movements(site_id, article_id, movement_type, qty, delta_available, delta_allocated, delta_quarantine,
      unit_cost, repair_order_id, receipt_line_id, reason, created_by_name, is_reversal, reversal_of)
    VALUES (m.site_id, m.article_id, m.movement_type, m.qty, -m.delta_available, -m.delta_allocated, -m.delta_quarantine,
      m.unit_cost, m.repair_order_id, m.receipt_line_id, 'Annulation réception : ' || trim(_reason), _user_name, true, m.id);
    n_mv := n_mv + 1;
  END LOOP;

  UPDATE or_part_usage u SET usage_status = 'not_used', qty_used = 0, reason = 'Réception annulée', comment = trim(_reason)
  FROM part_receipt_lines pl WHERE pl.id = u.receipt_line_id AND pl.receipt_id = _receipt AND u.usage_status = 'pending';

  FOR l IN SELECT * FROM part_receipt_lines WHERE receipt_id = _receipt AND order_line_id IS NOT NULL AND qty_received > 0 LOOP
    UPDATE part_order_lines ol SET
      qty_received = greatest(0, coalesce(ol.qty_received,0) - l.qty_received),
      status = CASE WHEN ol.status = 'cancelled' THEN 'cancelled'
                    WHEN greatest(0, coalesce(ol.qty_received,0) - l.qty_received) <= 0 THEN 'ordered'
                    WHEN ol.qty_ordered IS NULL THEN 'received'
                    WHEN greatest(0, coalesce(ol.qty_received,0) - l.qty_received) >= ol.qty_ordered THEN 'received'
                    ELSE 'partial' END
    WHERE ol.id = l.order_line_id;
    n_lines := n_lines + 1;
  END LOOP;

  UPDATE part_receipts SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
    cancelled_by_name = _user_name, cancel_reason = trim(_reason) WHERE id = _receipt;

  IF r.order_id IS NOT NULL THEN
    SELECT count(*) FILTER (WHERE line_kind = 'part'),
           count(*) FILTER (WHERE line_kind = 'part' AND status = 'received'),
           count(*) FILTER (WHERE line_kind = 'part' AND status NOT IN ('ordered','cancelled'))
      INTO parts, recv, notordered FROM part_order_lines WHERE order_id = r.order_id;
    anyrec := EXISTS (SELECT 1 FROM part_receipts WHERE order_id = r.order_id AND status <> 'cancelled');
    UPDATE part_orders SET status = CASE
        WHEN parts = 0 THEN CASE WHEN anyrec THEN 'received' ELSE 'ordered' END
        WHEN recv = parts THEN 'received'
        WHEN notordered > 0 OR anyrec THEN 'partial'
        ELSE 'ordered' END
    WHERE id = r.order_id AND status <> 'cancelled';
  END IF;

  INSERT INTO parts_events(site_id, entity, entity_id, repair_order_id, action, detail, created_by_name)
  VALUES (r.site_id, 'part_receipt', _receipt, r.repair_order_id, 'cancel', jsonb_build_object('reason', trim(_reason), 'reversed_movements', n_mv, 'order_lines', n_lines), _user_name);
  RETURN jsonb_build_object('reversed_movements', n_mv, 'order_lines', n_lines);
END $$;

CREATE OR REPLACE FUNCTION public.cancel_part_order(_order uuid, _reason text, _user_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.part_orders%ROWTYPE; received numeric; n int;
BEGIN
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN RAISE EXCEPTION 'Motif d''annulation obligatoire'; END IF;
  SELECT * INTO o FROM public.part_orders WHERE id = _order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable'; END IF;
  IF NOT (is_active_user(auth.uid()) AND user_can_access_site(auth.uid(), o.site_id)) THEN RAISE EXCEPTION 'Accès refusé à ce site'; END IF;
  IF o.status = 'cancelled' THEN RAISE EXCEPTION 'Commande déjà annulée'; END IF;
  IF o.status = 'received' THEN RAISE EXCEPTION 'Commande entièrement reçue : annulez plutôt la réception.'; END IF;
  SELECT coalesce(sum(qty_received),0) INTO received FROM part_order_lines WHERE order_id = _order AND line_kind = 'part';
  UPDATE part_order_lines SET status = 'cancelled' WHERE order_id = _order AND status IN ('ordered','partial');
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE part_orders SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancelled_by_name = _user_name, cancel_reason = trim(_reason) WHERE id = _order;
  INSERT INTO parts_events(site_id, entity, entity_id, repair_order_id, action, detail, created_by_name)
  VALUES (o.site_id, 'part_order', _order, o.repair_order_id, 'cancel', jsonb_build_object('reason', trim(_reason), 'qty_already_received', received, 'lines_cancelled', n), _user_name);
  RETURN jsonb_build_object('qty_already_received', received, 'lines_cancelled', n);
END $$;

REVOKE ALL ON FUNCTION public.cancel_part_receipt(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_part_order(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_part_receipt(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_part_order(uuid, text, text) TO authenticated;