CREATE OR REPLACE FUNCTION public.generate_procurement_orders(_list uuid, _user_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l public.procurement_lists%ROWTYPE;
  _sup uuid; _order uuid; _line uuid; r record;
  _ro uuid; _orders jsonb := '[]'::jsonb; _n int; _left int; _done int;
BEGIN
  SELECT * INTO l FROM public.procurement_lists WHERE id = _list FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LIST_NOT_FOUND'; END IF;
  IF NOT (public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), l.site_id)) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF l.status = 'cancelled' THEN RAISE EXCEPTION 'LIST_CANCELLED'; END IF;
  IF public.norm_or_number(l.requested_or_number) IS NULL THEN RAISE EXCEPTION 'OR_REQUIRED'; END IF;
  _ro := COALESCE(l.repair_order_id, public.resolve_or_for_order(l.site_id, l.requested_or_number, l.plate));
  IF _ro IS NOT NULL AND l.repair_order_id IS NULL THEN
    UPDATE public.procurement_lists SET repair_order_id = _ro WHERE id = _list;
  END IF;
  FOR _sup IN
    SELECT DISTINCT supplier_id FROM public.procurement_list_lines
    WHERE list_id = _list AND supplier_id IS NOT NULL AND generated_order_id IS NULL AND status <> 'cancelled'
  LOOP
    INSERT INTO public.part_orders (site_id, supplier_id, order_mode, destination, repair_order_id, plate, requested_or_number,
      order_date, comment, created_by, created_by_name, procurement_list_id)
    VALUES (l.site_id, _sup, 'detailed', 'or', _ro, l.plate, l.requested_or_number,
      (now() AT TIME ZONE 'Europe/Paris')::date,
      'Liste d''approvisionnement' || COALESCE(' — ' || l.source_label, ''), auth.uid(), _user_name, _list)
    RETURNING id INTO _order;
    _n := 0;
    FOR r IN SELECT * FROM public.procurement_list_lines
      WHERE list_id = _list AND supplier_id = _sup AND generated_order_id IS NULL AND status <> 'cancelled' ORDER BY position, created_at
    LOOP
      INSERT INTO public.part_order_lines (order_id, line_kind, physical_reference, designation, qty_ordered, expected_unit_cost_ht, repair_order_id, requested_or_number)
      VALUES (_order, CASE WHEN r.item_type IN ('fee','service') THEN 'fee' ELSE 'part' END, NULLIF(btrim(COALESCE(r.reference,'')), ''), r.designation, r.quantity, NULL, _ro, l.requested_or_number)
      RETURNING id INTO _line;
      UPDATE public.procurement_list_lines SET generated_order_id = _order, generated_order_line_id = _line, status = 'ordered' WHERE id = r.id;
      _n := _n + 1;
    END LOOP;
    INSERT INTO public.parts_events (site_id, entity, entity_id, repair_order_id, action, detail, created_by, created_by_name)
    VALUES (l.site_id, 'part_order', _order, _ro, 'create', jsonb_build_object('from_procurement_list', _list, 'lines', _n), auth.uid(), _user_name);
    _orders := _orders || jsonb_build_object('order_id', _order, 'supplier_id', _sup, 'lines', _n);
  END LOOP;
  SELECT count(*) FILTER (WHERE generated_order_id IS NULL AND status <> 'cancelled'), count(*) FILTER (WHERE generated_order_id IS NOT NULL)
    INTO _left, _done FROM public.procurement_list_lines WHERE list_id = _list;
  UPDATE public.procurement_lists SET status = CASE WHEN _done = 0 THEN status WHEN _left = 0 THEN 'ordered' ELSE 'partial' END WHERE id = _list;
  RETURN jsonb_build_object('orders', _orders, 'remaining', _left, 'repair_order_id', _ro);
END $$;
REVOKE EXECUTE ON FUNCTION public.generate_procurement_orders(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_procurement_orders(uuid, text) TO authenticated;