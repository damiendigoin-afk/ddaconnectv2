CREATE OR REPLACE FUNCTION public.storage_object_owned(_name text, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'storage'
AS $function$
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
              OR public.can_manage_expense(_user_id, e.site_id, 'validate')
              OR public.can_manage_expense(_user_id, e.site_id, 'account')
            )
        )
      )
      ELSE public.has_role(_user_id, 'manager')
    END
  );
$function$;