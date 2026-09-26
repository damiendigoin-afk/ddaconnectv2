-- V3 Phase B : commandes, réceptions physiques, stock, mouvements, temps atelier, pointage pièces, état travaux, régularisations.
CREATE TABLE public.part_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id),
  supplier_id uuid REFERENCES public.suppliers(id),
  order_mode text NOT NULL DEFAULT 'simplified' CHECK (order_mode IN ('simplified','detailed')),
  destination text NOT NULL DEFAULT 'or' CHECK (destination IN ('or','store_sale','stock')),
  repair_order_id uuid REFERENCES public.repair_orders(id),
  vehicle_id uuid,
  plate text,
  appointment_date date,
  supplier_order_ref text,
  comment text,
  status text NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered','partial','received','cancelled')),
  source_document_id uuid REFERENCES public.inbox_documents(id),
  created_by uuid DEFAULT auth.uid(),
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.part_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.part_orders(id) ON DELETE CASCADE,
  line_kind text NOT NULL DEFAULT 'part' CHECK (line_kind IN ('part','fee','deposit')),
  physical_reference text,
  designation text,
  qty_ordered numeric,
  qty_received numeric NOT NULL DEFAULT 0,
  expected_unit_cost_ht numeric,
  status text NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered','partial','received','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.part_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id),
  supplier_id uuid REFERENCES public.suppliers(id),
  order_id uuid REFERENCES public.part_orders(id),
  repair_order_id uuid REFERENCES public.repair_orders(id),
  vehicle_id uuid,
  plate text,
  source_document_id uuid REFERENCES public.inbox_documents(id),
  receipt_type text NOT NULL DEFAULT 'physical_without_document' CHECK (receipt_type IN ('document','physical_without_document','invoice_as_delivery')),
  status text NOT NULL DEFAULT 'validated' CHECK (status IN ('validated','cancelled','incident')),
  packages text,
  comment text,
  received_by uuid DEFAULT auth.uid(),
  received_by_name text,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.stock_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id),
  physical_reference text NOT NULL,
  reference_normalized text NOT NULL,
  designation text,
  logical_article_id uuid,
  unit text NOT NULL DEFAULT 'u' CHECK (unit IN ('u','l')),
  is_oil boolean NOT NULL DEFAULT false,
  location text,
  pamp numeric,
  last_purchase_price numeric,
  last_purchase_at timestamptz,
  last_supplier_id uuid REFERENCES public.suppliers(id),
  opening_value_source text CHECK (opening_value_source IN ('historical','estimated')),
  photo_path text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, reference_normalized)
);
CREATE TABLE public.part_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.part_receipts(id) ON DELETE CASCADE,
  order_line_id uuid REFERENCES public.part_order_lines(id),
  article_id uuid REFERENCES public.stock_articles(id),
  physical_reference text,
  designation text,
  qty_expected numeric,
  qty_received numeric NOT NULL DEFAULT 0,
  condition text NOT NULL DEFAULT 'usable' CHECK (condition IN ('usable','damaged_return','to_check')),
  destination text NOT NULL DEFAULT 'unknown' CHECK (destination IN ('or','store_sale','stock','unknown')),
  repair_order_id uuid REFERENCES public.repair_orders(id),
  qty_allocated numeric NOT NULL DEFAULT 0,
  unit_cost_provisional numeric,
  wrong_reference boolean NOT NULL DEFAULT false,
  over_receipt boolean NOT NULL DEFAULT false,
  price_gap boolean NOT NULL DEFAULT false,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id),
  article_id uuid NOT NULL REFERENCES public.stock_articles(id),
  movement_type text NOT NULL CHECK (movement_type IN ('receipt_in','allocate_to_or','deallocate_from_or','supplier_return_out','manual_adjustment','damaged_quarantine','store_sale_final','or_sale_final')),
  qty numeric NOT NULL,
  delta_available numeric NOT NULL DEFAULT 0,
  delta_allocated numeric NOT NULL DEFAULT 0,
  delta_quarantine numeric NOT NULL DEFAULT 0,
  unit_cost numeric,
  repair_order_id uuid REFERENCES public.repair_orders(id),
  receipt_line_id uuid REFERENCES public.part_receipt_lines(id),
  part_return_id uuid,
  reason text,
  created_by uuid DEFAULT auth.uid(),
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.stock_movements(article_id);
CREATE INDEX ON public.stock_movements(repair_order_id);

CREATE TABLE public.work_time_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_order_id uuid NOT NULL REFERENCES public.repair_orders(id),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  user_name text,
  site_id uuid REFERENCES public.sites(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  stopped_at timestamptz,
  source text NOT NULL DEFAULT 'app',
  corrected_by uuid,
  corrected_at timestamptz,
  correction_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.work_time_sessions(repair_order_id);
CREATE INDEX ON public.work_time_sessions(user_id) WHERE stopped_at IS NULL;

CREATE TABLE public.or_part_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_order_id uuid NOT NULL REFERENCES public.repair_orders(id),
  site_id uuid REFERENCES public.sites(id),
  article_id uuid REFERENCES public.stock_articles(id),
  receipt_line_id uuid REFERENCES public.part_receipt_lines(id),
  movement_id uuid REFERENCES public.stock_movements(id),
  item_kind text NOT NULL DEFAULT 'part' CHECK (item_kind IN ('part','oil','consumable')),
  physical_reference text,
  designation text,
  qty_allocated numeric NOT NULL DEFAULT 0,
  qty_used numeric,
  usage_status text NOT NULL DEFAULT 'pending' CHECK (usage_status IN ('pending','used','not_used','partial')),
  reason text,
  comment text,
  unplanned boolean NOT NULL DEFAULT false,
  confirmed_by uuid,
  confirmed_by_name text,
  confirmed_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.or_part_usage(repair_order_id);

CREATE TABLE public.or_work_state (
  repair_order_id uuid PRIMARY KEY REFERENCES public.repair_orders(id),
  site_id uuid REFERENCES public.sites(id),
  state text NOT NULL DEFAULT 'en_cours' CHECK (state IN ('en_cours','travaux_termines','a_revalider')),
  finished_at timestamptz,
  finished_by uuid,
  finished_by_name text,
  forced boolean NOT NULL DEFAULT false,
  force_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.parts_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id),
  entity text NOT NULL,
  entity_id uuid,
  repair_order_id uuid,
  action text NOT NULL,
  detail jsonb,
  created_by uuid DEFAULT auth.uid(),
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.parts_events(repair_order_id);

CREATE TABLE public.parts_regularizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id),
  kind text NOT NULL,
  source_table text,
  source_id uuid,
  repair_order_id uuid REFERENCES public.repair_orders(id),
  supplier_id uuid REFERENCES public.suppliers(id),
  physical_reference text,
  plate text,
  comment text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_by uuid,
  closed_by_name text,
  closed_at timestamptz,
  closing_comment text,
  created_by uuid DEFAULT auth.uid(),
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE VIEW public.stock_levels WITH (security_invoker = true) AS
SELECT a.id AS article_id, a.site_id,
  COALESCE(SUM(m.delta_available),0) AS available_qty,
  COALESCE(SUM(m.delta_allocated),0) AS allocated_qty,
  COALESCE(SUM(m.delta_quarantine),0) AS quarantine_qty,
  MIN(m.created_at) FILTER (WHERE m.movement_type = 'receipt_in') AS first_receipt_at
FROM public.stock_articles a LEFT JOIN public.stock_movements m ON m.article_id = a.id
GROUP BY a.id, a.site_id;

-- GRANTs
GRANT SELECT, INSERT, UPDATE ON public.part_orders, public.part_order_lines, public.part_receipts, public.part_receipt_lines,
  public.stock_articles, public.work_time_sessions, public.or_part_usage, public.or_work_state, public.parts_regularizations TO authenticated;
GRANT DELETE ON public.part_order_lines TO authenticated;
GRANT SELECT, INSERT ON public.stock_movements, public.parts_events TO authenticated;
GRANT SELECT ON public.stock_levels TO authenticated;
GRANT ALL ON public.part_orders, public.part_order_lines, public.part_receipts, public.part_receipt_lines, public.stock_articles,
  public.stock_movements, public.work_time_sessions, public.or_part_usage, public.or_work_state, public.parts_events, public.parts_regularizations TO service_role;
GRANT SELECT ON public.stock_levels TO service_role;

-- RLS : lecture groupe pour comptes actifs, écriture limitée aux sites accessibles.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['part_orders','part_receipts','stock_articles','stock_movements','parts_regularizations','or_work_state'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()))', t||'_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), site_id))', t||'_insert', t);
    IF t <> 'stock_movements' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), site_id)) WITH CHECK (public.user_can_access_site(auth.uid(), site_id))', t||'_update', t);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.part_order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY pol_read ON public.part_order_lines FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY pol_write ON public.part_order_lines FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.part_orders o WHERE o.id = order_id AND public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), o.site_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.part_orders o WHERE o.id = order_id AND public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), o.site_id)));

ALTER TABLE public.part_receipt_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY prl_read ON public.part_receipt_lines FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY prl_write ON public.part_receipt_lines FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.part_receipts r WHERE r.id = receipt_id AND public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), r.site_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.part_receipts r WHERE r.id = receipt_id AND public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), r.site_id)));

-- Temps et pointage : tout utilisateur actif travaillant sur l'OR (lignes communes à l'OR).
ALTER TABLE public.work_time_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY wts_read ON public.work_time_sessions FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY wts_insert ON public.work_time_sessions FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()) AND user_id = auth.uid());
CREATE POLICY wts_update ON public.work_time_sessions FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));

ALTER TABLE public.or_part_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY opu_read ON public.or_part_usage FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY opu_insert ON public.or_part_usage FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY opu_update ON public.or_part_usage FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));

ALTER TABLE public.parts_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY pe_read ON public.parts_events FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY pe_insert ON public.parts_events FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));

CREATE TRIGGER trg_part_orders_upd BEFORE UPDATE ON public.part_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_part_order_lines_upd BEFORE UPDATE ON public.part_order_lines FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_part_receipts_upd BEFORE UPDATE ON public.part_receipts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_stock_articles_upd BEFORE UPDATE ON public.stock_articles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_or_part_usage_upd BEFORE UPDATE ON public.or_part_usage FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_or_work_state_upd BEFORE UPDATE ON public.or_work_state FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();