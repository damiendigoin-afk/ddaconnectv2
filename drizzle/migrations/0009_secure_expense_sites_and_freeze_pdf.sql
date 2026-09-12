ALTER TABLE public.expense_notes
  ADD COLUMN IF NOT EXISTS validated_pdf_path text,
  ADD COLUMN IF NOT EXISTS employee_notified_at timestamptz;

CREATE INDEX IF NOT EXISTS expense_notes_user_status_idx
  ON public.expense_notes (user_id, status, site_id);

CREATE OR REPLACE FUNCTION public.user_can_access_site(_user_id uuid, _site_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _site_id IS NOT NULL AND (
    public.has_role(_user_id, 'manager')
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = _user_id
        AND (p.site_scope = 'groupe' OR p.site_id = _site_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.user_sites us
      WHERE us.user_id = _user_id AND us.site_id = _site_id
    )
  )
$$;

REVOKE ALL ON FUNCTION public.user_can_access_site(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_access_site(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_site(uuid, uuid) TO service_role;

DROP POLICY IF EXISTS uf_read ON public.user_functions;
CREATE POLICY uf_read ON public.user_functions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'manager'));

DROP POLICY IF EXISTS us_read ON public.user_sites;
CREATE POLICY us_read ON public.user_sites FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'manager'));

DROP POLICY IF EXISTS exp_function_read ON public.expense_notes;
CREATE POLICY exp_function_read ON public.expense_notes FOR SELECT TO authenticated
  USING (
    public.user_can_access_site(auth.uid(), site_id)
    AND (
      public.has_user_function(auth.uid(), 'valider_notes_frais')
      OR public.has_user_function(auth.uid(), 'comptabilite')
    )
  );

DROP POLICY IF EXISTS exp_function_update ON public.expense_notes;
CREATE POLICY exp_function_update ON public.expense_notes FOR UPDATE TO authenticated
  USING (
    public.user_can_access_site(auth.uid(), site_id)
    AND (
      public.has_user_function(auth.uid(), 'valider_notes_frais')
      OR public.has_user_function(auth.uid(), 'comptabilite')
    )
  )
  WITH CHECK (
    public.user_can_access_site(auth.uid(), site_id)
    AND (
      public.has_user_function(auth.uid(), 'valider_notes_frais')
      OR public.has_user_function(auth.uid(), 'comptabilite')
    )
  );

CREATE OR REPLACE FUNCTION public.storage_object_owned(_name text, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT public.is_active_user(_user_id)
  AND (
    CASE split_part(_name, '/', 1)
      WHEN 'inspections' THEN EXISTS (SELECT 1 FROM public.vehicle_inspections i WHERE i.id::text = split_part(_name, '/', 2))
      WHEN 'tours'       THEN EXISTS (SELECT 1 FROM public.vehicle_inspections i WHERE i.id::text = split_part(_name, '/', 2))
      WHEN 'expertises'  THEN EXISTS (SELECT 1 FROM public.vehicle_expertises e WHERE e.id::text = split_part(_name, '/', 2))
      WHEN 'orders'      THEN EXISTS (SELECT 1 FROM public.repair_orders r WHERE r.id::text = split_part(_name, '/', 2))
      WHEN 'notes-frais' THEN (
        split_part(_name, '/', 2) = _user_id::text
        OR public.has_role(_user_id, 'manager')
        OR EXISTS (
          SELECT 1 FROM public.expense_notes e
          WHERE (e.receipt_path = _name OR e.validated_pdf_path = _name OR e.id::text = split_part(_name, '/', 2))
            AND (
              e.user_id = _user_id
              OR (
                public.user_can_access_site(_user_id, e.site_id)
                AND (
                  public.has_user_function(_user_id, 'valider_notes_frais')
                  OR public.has_user_function(_user_id, 'comptabilite')
                )
              )
            )
        )
      )
      ELSE public.has_role(_user_id, 'manager')
    END
  );
$$;

REVOKE ALL ON FUNCTION public.storage_object_owned(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_object_owned(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.storage_object_owned(text, uuid) TO service_role;