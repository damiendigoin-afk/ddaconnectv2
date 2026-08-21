CREATE OR REPLACE FUNCTION public.storage_object_owned(_name text, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, storage
AS $$
  SELECT public.is_active_user(_user_id)
  AND (
    CASE split_part(_name, '/', 1)
      WHEN 'inspections' THEN EXISTS (SELECT 1 FROM public.vehicle_inspections i WHERE i.id::text = split_part(_name, '/', 2))
      WHEN 'tours'       THEN EXISTS (SELECT 1 FROM public.vehicle_inspections i WHERE i.id::text = split_part(_name, '/', 2))
      WHEN 'expertises'  THEN EXISTS (SELECT 1 FROM public.vehicle_expertises e WHERE e.id::text = split_part(_name, '/', 2))
      WHEN 'orders'      THEN EXISTS (SELECT 1 FROM public.repair_orders r WHERE r.id::text = split_part(_name, '/', 2))
      ELSE public.has_role(_user_id, 'manager')
    END
  );
$$;

DROP POLICY IF EXISTS dda_media_read   ON storage.objects;
DROP POLICY IF EXISTS dda_media_insert  ON storage.objects;
DROP POLICY IF EXISTS dda_media_update  ON storage.objects;
DROP POLICY IF EXISTS dda_media_delete  ON storage.objects;

CREATE POLICY dda_media_read   ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'dda-media' AND public.storage_object_owned(name, auth.uid()));

CREATE POLICY dda_media_insert  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'dda-media' AND public.storage_object_owned(name, auth.uid()));

CREATE POLICY dda_media_update  ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'dda-media' AND public.storage_object_owned(name, auth.uid()))
  WITH CHECK (bucket_id = 'dda-media' AND public.storage_object_owned(name, auth.uid()));

CREATE POLICY dda_media_delete  ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'dda-media' AND public.storage_object_owned(name, auth.uid()));