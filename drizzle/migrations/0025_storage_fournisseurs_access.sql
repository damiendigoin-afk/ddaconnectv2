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
      -- BL / factures fournisseur (Pièces & achats) : module « magasin » requis.
      -- Fichier déjà rattaché : accès seulement si le document est sur un site autorisé.
      -- Fichier pas encore rattaché (envoi initial, avant création du document) : autorisé.
      WHEN 'fournisseurs' THEN (
        public.has_role(_user_id, 'manager')
        OR (
          EXISTS (SELECT 1 FROM public.user_module_access a
                  WHERE a.user_id = _user_id AND a.allowed AND a.module_key = 'magasin')
          AND (
            EXISTS (SELECT 1 FROM public.inbox_documents d
                    WHERE d.storage_path = _name
                      AND (d.site_id IS NULL OR public.user_can_access_site(_user_id, d.site_id)))
            OR NOT EXISTS (SELECT 1 FROM public.inbox_documents d WHERE d.storage_path = _name)
          )
        )
      )
      ELSE public.has_role(_user_id, 'manager')
    END
  );
$function$;