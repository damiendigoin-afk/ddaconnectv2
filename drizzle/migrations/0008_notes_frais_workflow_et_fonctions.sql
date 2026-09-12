-- 1. Fonctions / droits cumulables par utilisateur
CREATE TABLE IF NOT EXISTS public.user_functions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  function_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, function_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_functions TO authenticated;
GRANT ALL ON public.user_functions TO service_role;
ALTER TABLE public.user_functions ENABLE ROW LEVEL SECURITY;

CREATE POLICY uf_read ON public.user_functions FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()));
CREATE POLICY uf_write ON public.user_functions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'manager'));

CREATE OR REPLACE FUNCTION public.has_user_function(_user_id uuid, _key text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_functions WHERE user_id = _user_id AND function_key = _key)
$$;

-- 2. Périmètre multi-sites autorisé (complément du site par défaut existant)
CREATE TABLE IF NOT EXISTS public.user_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, site_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_sites TO authenticated;
GRANT ALL ON public.user_sites TO service_role;
ALTER TABLE public.user_sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY us_read ON public.user_sites FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()));
CREATE POLICY us_write ON public.user_sites FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'manager'));

-- 3. Notes de frais : workflow scan -> validation -> compta -> règlement
ALTER TABLE public.expense_notes
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'perso',
  ADD COLUMN IF NOT EXISTS purpose text,
  ADD COLUMN IF NOT EXISTS vat_rate numeric,
  ADD COLUMN IF NOT EXISTS receipt_mime text,
  ADD COLUMN IF NOT EXISTS validated_by uuid,
  ADD COLUMN IF NOT EXISTS validated_by_name text,
  ADD COLUMN IF NOT EXISTS validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS accounting_email text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS send_status text,
  ADD COLUMN IF NOT EXISTS send_error text,
  ADD COLUMN IF NOT EXISTS settled_at date,
  ADD COLUMN IF NOT EXISTS settled_by_name text,
  ADD COLUMN IF NOT EXISTS accounted_at timestamptz,
  ADD COLUMN IF NOT EXISTS accounted_by_name text;

CREATE INDEX IF NOT EXISTS expense_notes_status_idx ON public.expense_notes (status, site_id);

CREATE POLICY exp_function_read ON public.expense_notes FOR SELECT TO authenticated
  USING (
    public.has_user_function(auth.uid(), 'valider_notes_frais')
    OR public.has_user_function(auth.uid(), 'comptabilite')
  );

CREATE POLICY exp_function_update ON public.expense_notes FOR UPDATE TO authenticated
  USING (
    public.has_user_function(auth.uid(), 'valider_notes_frais')
    OR public.has_user_function(auth.uid(), 'comptabilite')
  )
  WITH CHECK (
    public.has_user_function(auth.uid(), 'valider_notes_frais')
    OR public.has_user_function(auth.uid(), 'comptabilite')
  );

-- 4. Justificatifs stockés sous notes-frais/<note>/... dans le bucket existant
CREATE OR REPLACE FUNCTION public.storage_object_owned(_name text, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT public.is_active_user(_user_id)
  AND (
    CASE split_part(_name, '/', 1)
      WHEN 'inspections' THEN EXISTS (SELECT 1 FROM public.vehicle_inspections i WHERE i.id::text = split_part(_name, '/', 2))
      WHEN 'tours'       THEN EXISTS (SELECT 1 FROM public.vehicle_inspections i WHERE i.id::text = split_part(_name, '/', 2))
      WHEN 'expertises'  THEN EXISTS (SELECT 1 FROM public.vehicle_expertises e WHERE e.id::text = split_part(_name, '/', 2))
      WHEN 'orders'      THEN EXISTS (SELECT 1 FROM public.repair_orders r WHERE r.id::text = split_part(_name, '/', 2))
      WHEN 'notes-frais' THEN true
      ELSE public.has_role(_user_id, 'manager')
    END
  );
$$;