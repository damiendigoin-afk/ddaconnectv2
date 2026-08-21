-- 1) profiles : lecture restreinte (soi-même ou manager)
DROP POLICY IF EXISTS "profiles readable by authenticated" ON public.profiles;
CREATE POLICY "profiles readable by self or manager"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'manager'));

-- 2) sites : lecture réservée aux utilisateurs actifs
DROP POLICY IF EXISTS "sites readable by all" ON public.sites;
CREATE POLICY "sites readable by active users"
  ON public.sites FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()));

-- 3) field_changes : déjà restreint à authenticated, on s'assure qu'aucun accès anon ne subsiste
REVOKE ALL ON public.field_changes FROM anon;
REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.sites FROM anon;

-- 4) SECURITY DEFINER : retirer l'exécution à PUBLIC/anon
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_active_user(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.storage_object_owned(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_storage_stats() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purge_stale_drafts(integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_user(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_object_owned(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.platform_storage_stats() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_stale_drafts(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;