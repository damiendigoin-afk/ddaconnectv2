ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS group_name text,
  ADD COLUMN IF NOT EXISTS trade_name text,
  ADD COLUMN IF NOT EXISTS website text;

CREATE TABLE public.supplier_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  service text NOT NULL DEFAULT 'autre',
  last_name text,
  first_name text,
  role_title text,
  phone text,
  mobile text,
  email text,
  is_primary boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_contacts TO authenticated;
GRANT ALL ON public.supplier_contacts TO service_role;

ALTER TABLE public.supplier_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "supplier_contacts_select" ON public.supplier_contacts
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "supplier_contacts_insert" ON public.supplier_contacts
  FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "supplier_contacts_update" ON public.supplier_contacts
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'manager'));
CREATE POLICY "supplier_contacts_delete" ON public.supplier_contacts
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'manager'));

CREATE INDEX idx_supplier_contacts_supplier ON public.supplier_contacts(supplier_id);

CREATE TRIGGER trg_supplier_contacts_updated
  BEFORE UPDATE ON public.supplier_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();