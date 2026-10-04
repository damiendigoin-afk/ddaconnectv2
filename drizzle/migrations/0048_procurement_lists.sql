CREATE TABLE public.procurement_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id),
  source_document_id uuid REFERENCES public.inbox_documents(id),
  source_type text NOT NULL DEFAULT 'other' CHECK (source_type IN ('expertise','ixellio','manual','other')),
  source_label text,
  requested_or_number text,
  repair_order_id uuid REFERENCES public.repair_orders(id),
  plate text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','ordered','partial','completed','cancelled')),
  extraction_route text,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid DEFAULT auth.uid(),
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX procurement_lists_site_idx ON public.procurement_lists(site_id, created_at DESC);

CREATE TABLE public.procurement_list_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.procurement_lists(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  designation text NOT NULL CHECK (btrim(designation) <> ''),
  reference text,
  quantity numeric NOT NULL DEFAULT 1 CHECK (quantity > 0),
  source_price_ht numeric,
  source_operation text,
  item_type text NOT NULL DEFAULT 'part' CHECK (item_type IN ('part','consumable','fee','service')),
  supplier_id uuid REFERENCES public.suppliers(id),
  generated_order_id uuid REFERENCES public.part_orders(id),
  generated_order_line_id uuid REFERENCES public.part_order_lines(id),
  status text NOT NULL DEFAULT 'to_assign' CHECK (status IN ('to_assign','ready','ordered','cancelled')),
  original_text text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX procurement_list_lines_list_idx ON public.procurement_list_lines(list_id, position);

ALTER TABLE public.part_orders ADD COLUMN procurement_list_id uuid REFERENCES public.procurement_lists(id);
COMMENT ON COLUMN public.procurement_list_lines.source_price_ht IS 'Tarif / prix de vente indicatif du document source (expert, Ixellio). Jamais un PA.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.procurement_lists TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.procurement_list_lines TO authenticated;
GRANT ALL ON public.procurement_lists TO service_role;
GRANT ALL ON public.procurement_list_lines TO service_role;

ALTER TABLE public.procurement_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_list_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY procurement_lists_read ON public.procurement_lists FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), site_id));
CREATE POLICY procurement_lists_insert ON public.procurement_lists FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), site_id));
CREATE POLICY procurement_lists_update ON public.procurement_lists FOR UPDATE TO authenticated
  USING (public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), site_id))
  WITH CHECK (public.user_can_access_site(auth.uid(), site_id));

CREATE POLICY procurement_lines_read ON public.procurement_list_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.procurement_lists l WHERE l.id = list_id AND public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), l.site_id)));
CREATE POLICY procurement_lines_insert ON public.procurement_list_lines FOR INSERT TO authenticated
  WITH CHECK (generated_order_id IS NULL AND EXISTS (SELECT 1 FROM public.procurement_lists l WHERE l.id = list_id AND public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), l.site_id)));
CREATE POLICY procurement_lines_update ON public.procurement_list_lines FOR UPDATE TO authenticated
  USING (generated_order_id IS NULL AND EXISTS (SELECT 1 FROM public.procurement_lists l WHERE l.id = list_id AND public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), l.site_id)))
  WITH CHECK (generated_order_id IS NULL);
CREATE POLICY procurement_lines_delete ON public.procurement_list_lines FOR DELETE TO authenticated
  USING (generated_order_id IS NULL AND EXISTS (SELECT 1 FROM public.procurement_lists l WHERE l.id = list_id AND public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), l.site_id)));

CREATE TRIGGER procurement_lists_updated BEFORE UPDATE ON public.procurement_lists FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER procurement_lines_updated BEFORE UPDATE ON public.procurement_list_lines FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Génération idempotente : verrou sur la liste, seules les lignes prêtes non générées, une commande par fournisseur.
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
      -- PA (expected_unit_cost_ht) volontairement NULL : le prix source n'est jamais un prix d'achat.
      INSERT INTO public.part_order_lines (order_id, line_kind, physical_reference, designation, qty_ordered, expected_unit_cost_ht, repair_order_id, requested_or_number)
      VALUES (_order, CASE WHEN r.item_type IN ('fee','service') THEN 'fee' ELSE 'part' END, NULLIF(btrim(COALESCE(r.reference,'')), ''), r.designation, r.quantity, NULL, _ro, l.requested_or_number)
      RETURNING id INTO _line;
      UPDATE public.procurement_list_lines SET generated_order_id = _order, generated_order_line_id = _line, status = 'ordered' WHERE id = r.id;
      _n := _n + 1;
    END LOOP;
    INSERT INTO public.parts_events (site_id, entity, entity_id, repair_order_id, action, detail, user_id, user_name)
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