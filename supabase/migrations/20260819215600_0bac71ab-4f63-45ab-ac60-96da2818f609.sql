CREATE OR REPLACE FUNCTION public.platform_storage_stats()
RETURNS TABLE(bucket_bytes bigint, bucket_files bigint, db_bytes bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'manager') THEN
    RAISE EXCEPTION 'Accès réservé aux managers';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM((o.metadata->>'size')::bigint), 0)::bigint,
    COUNT(*)::bigint,
    pg_database_size(current_database())::bigint
  FROM storage.objects o;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_storage_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_storage_stats() TO authenticated, service_role;