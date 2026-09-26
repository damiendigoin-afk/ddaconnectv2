CREATE OR REPLACE FUNCTION public.can_manage_expense(_user_id uuid, _site_id uuid, _action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- V3 : accès au menu Notes de frais = accès à toutes ses fonctions (validation, comptabilisation).
  -- Les anciennes clés fines restent reconnues pour ne rien retirer aux comptes existants.
  SELECT public.is_active_user(_user_id)
    AND public.user_can_access_site(_user_id, _site_id)
    AND (
      public.has_role(_user_id, 'manager')
      OR public.has_user_function(_user_id, 'valider_notes_frais')
      OR public.has_user_function(_user_id, 'comptabilite')
      OR EXISTS (
        SELECT 1 FROM public.user_module_access a
        WHERE a.user_id = _user_id AND a.allowed
          AND a.module_key IN ('notes_frais', 'notes_frais_valider', 'notes_frais_compta')
      )
    )
$function$;