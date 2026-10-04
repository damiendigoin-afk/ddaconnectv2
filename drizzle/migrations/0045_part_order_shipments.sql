ALTER TABLE public.part_order_lines ADD COLUMN IF NOT EXISTS qty_shipped numeric NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.part_order_lines.qty_shipped IS 'Quantité expédiée par le fournisseur (BL/facture/avis d''expédition). Jamais du stock : seule qty_received reflète la réception physique.';

CREATE TABLE public.part_order_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  order_id uuid NOT NULL REFERENCES public.part_orders(id) ON DELETE CASCADE,
  order_line_id uuid NOT NULL REFERENCES public.part_order_lines(id) ON DELETE CASCADE,
  source_document_id uuid REFERENCES public.inbox_documents(id) ON DELETE SET NULL,
  qty numeric NOT NULL CHECK (qty > 0),
  shipped_on date,
  document_number text,
  created_by uuid DEFAULT auth.uid(),
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX part_order_shipments_doc_line_uq ON public.part_order_shipments(source_document_id, order_line_id) WHERE source_document_id IS NOT NULL;
CREATE INDEX part_order_shipments_order_idx ON public.part_order_shipments(order_id);

GRANT SELECT ON public.part_order_shipments TO authenticated;
GRANT ALL ON public.part_order_shipments TO service_role;
ALTER TABLE public.part_order_shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY pos_read ON public.part_order_shipments FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), site_id));

-- Enregistre une expédition fournisseur : aucune réception, aucun mouvement de stock, qty_received inchangée.
-- Idempotent par (document, ligne de commande).
CREATE OR REPLACE FUNCTION public.record_part_shipment(_order uuid, _doc uuid, _lines jsonb, _shipped_on date, _document_number text, _user_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o record; l jsonb; ol record; q numeric; n_new int := 0; n_skip int := 0;
BEGIN
  SELECT id, site_id, status, repair_order_id INTO o FROM part_orders WHERE id = _order;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Commande introuvable'; END IF;
  IF NOT (is_active_user(auth.uid()) AND user_can_access_site(auth.uid(), o.site_id)) THEN RAISE EXCEPTION 'Accès refusé'; END IF;
  IF o.status = 'cancelled' THEN RAISE EXCEPTION 'Commande annulée'; END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(coalesce(_lines, '[]'::jsonb)) LOOP
    q := nullif(l->>'qty', '')::numeric;
    IF q IS NULL OR q <= 0 THEN CONTINUE; END IF;
    SELECT id, order_id INTO ol FROM part_order_lines WHERE id = (l->>'order_line_id')::uuid;
    IF ol.id IS NULL OR ol.order_id <> _order THEN RAISE EXCEPTION 'Ligne hors commande'; END IF;
    IF _doc IS NOT NULL AND EXISTS (SELECT 1 FROM part_order_shipments WHERE source_document_id = _doc AND order_line_id = ol.id) THEN
      n_skip := n_skip + 1; CONTINUE;
    END IF;
    INSERT INTO part_order_shipments(site_id, order_id, order_line_id, source_document_id, qty, shipped_on, document_number, created_by_name)
      VALUES (o.site_id, _order, ol.id, _doc, q, _shipped_on, _document_number, _user_name);
    UPDATE part_order_lines SET qty_shipped = (SELECT coalesce(sum(qty),0) FROM part_order_shipments WHERE order_line_id = ol.id), updated_at = now() WHERE id = ol.id;
    n_new := n_new + 1;
  END LOOP;
  IF n_new > 0 THEN
    INSERT INTO parts_events(site_id, entity, entity_id, repair_order_id, action, detail, created_by, created_by_name)
      VALUES (o.site_id, 'part_order', _order, o.repair_order_id, 'shipment', jsonb_build_object('document_id', _doc, 'document_number', _document_number, 'shipped_on', _shipped_on, 'lines', _lines), auth.uid(), _user_name);
  END IF;
  RETURN jsonb_build_object('recorded', n_new, 'skipped', n_skip);
END $$;
REVOKE EXECUTE ON FUNCTION public.record_part_shipment(uuid, uuid, jsonb, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_part_shipment(uuid, uuid, jsonb, date, text, text) TO authenticated;