CREATE OR REPLACE FUNCTION public.can_manage_expense(_user_id uuid, _site_id uuid, _action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_can_access_site(_user_id, _site_id)
    AND (
      public.has_role(_user_id, 'manager')
      OR (
        _action = 'validate'
        AND (
          public.has_user_function(_user_id, 'valider_notes_frais')
          OR EXISTS (
            SELECT 1 FROM public.user_module_access a
            WHERE a.user_id = _user_id AND a.module_key = 'notes_frais_valider' AND a.allowed
          )
        )
      )
      OR (
        _action = 'account'
        AND (
          public.has_user_function(_user_id, 'comptabilite')
          OR EXISTS (
            SELECT 1 FROM public.user_module_access a
            WHERE a.user_id = _user_id AND a.module_key = 'notes_frais_compta' AND a.allowed
          )
        )
      )
    )
$$;

REVOKE ALL ON FUNCTION public.can_manage_expense(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_expense(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_expense(uuid, uuid, text) TO service_role;

DROP POLICY IF EXISTS exp_function_read ON public.expense_notes;
CREATE POLICY exp_function_read ON public.expense_notes FOR SELECT TO authenticated
  USING (
    public.can_manage_expense(auth.uid(), site_id, 'validate')
    OR public.can_manage_expense(auth.uid(), site_id, 'account')
  );

DROP POLICY IF EXISTS exp_function_update ON public.expense_notes;
CREATE POLICY exp_function_update ON public.expense_notes FOR UPDATE TO authenticated
  USING (
    public.can_manage_expense(auth.uid(), site_id, 'validate')
    OR public.can_manage_expense(auth.uid(), site_id, 'account')
  )
  WITH CHECK (
    public.can_manage_expense(auth.uid(), site_id, 'validate')
    OR public.can_manage_expense(auth.uid(), site_id, 'account')
  );