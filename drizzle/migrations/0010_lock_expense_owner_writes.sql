CREATE OR REPLACE FUNCTION public.can_create_expense(_user_id uuid, _site_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_active_user(_user_id)
    AND public.user_can_access_site(_user_id, _site_id)
    AND (
      public.has_role(_user_id, 'manager')
      OR EXISTS (
        SELECT 1 FROM public.user_module_access a
        WHERE a.user_id = _user_id
          AND a.allowed
          AND a.module_key IN ('notes_frais', 'notes_frais_creer')
      )
    )
$$;

REVOKE ALL ON FUNCTION public.can_create_expense(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_create_expense(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_create_expense(uuid, uuid) TO service_role;

DROP POLICY IF EXISTS exp_own_insert ON public.expense_notes;
CREATE POLICY exp_own_insert ON public.expense_notes FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status IN ('brouillon', 'soumis')
    AND public.can_create_expense(auth.uid(), site_id)
  );

DROP POLICY IF EXISTS exp_update ON public.expense_notes;
CREATE POLICY exp_manager_update ON public.expense_notes FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'manager'));

DROP POLICY IF EXISTS exp_delete ON public.expense_notes;
CREATE POLICY exp_delete ON public.expense_notes FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'manager')
    OR (user_id = auth.uid() AND status IN ('brouillon', 'soumis', 'refuse'))
  );