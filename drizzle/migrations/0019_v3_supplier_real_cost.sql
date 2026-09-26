-- Coût réel fournisseur : purement financier, aucune colonne de quantité physique touchée.
ALTER TABLE public.part_receipt_lines
  ADD COLUMN IF NOT EXISTS unit_cost_real numeric,
  ADD COLUMN IF NOT EXISTS unit_cost_real_at timestamptz,
  ADD COLUMN IF NOT EXISTS unit_cost_real_doc_id uuid;

CREATE TABLE public.supplier_cost_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id),
  document_id uuid NOT NULL REFERENCES public.inbox_documents(id) ON DELETE CASCADE,
  line_key text NOT NULL,
  doc_kind text NOT NULL DEFAULT 'invoice' CHECK (doc_kind IN ('invoice','credit')),
  supplier_name text,
  physical_reference text,
  designation text,
  qty numeric,
  unit_price_ht numeric,
  receipt_line_id uuid REFERENCES public.part_receipt_lines(id),
  article_id uuid REFERENCES public.stock_articles(id),
  reference_cost numeric,
  gap_abs numeric,
  status text NOT NULL CHECK (status IN ('applied','price_alert','unmatched','credit_financial','ignored')),
  applied_cost numeric,
  pamp_before numeric,
  pamp_after numeric,
  applied_at timestamptz,
  validated_by_name text,
  comment text,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, line_key)
);
CREATE INDEX ON public.supplier_cost_lines(receipt_line_id);
CREATE INDEX ON public.supplier_cost_lines(site_id, status);

GRANT SELECT, INSERT, UPDATE ON public.supplier_cost_lines TO authenticated;
GRANT ALL ON public.supplier_cost_lines TO service_role;
ALTER TABLE public.supplier_cost_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_cost_lines_select ON public.supplier_cost_lines FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()));
CREATE POLICY supplier_cost_lines_insert ON public.supplier_cost_lines FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), site_id));
CREATE POLICY supplier_cost_lines_update ON public.supplier_cost_lines FOR UPDATE TO authenticated
  USING (public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), site_id))
  WITH CHECK (public.user_can_access_site(auth.uid(), site_id));