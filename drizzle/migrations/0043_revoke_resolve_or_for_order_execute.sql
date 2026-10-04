-- resolve_or_for_order est un helper interne appelé uniquement par des triggers SECURITY DEFINER (propriétaire postgres).
-- Il ne doit pas être exécutable comme RPC publique (contournement RLS possible).
REVOKE EXECUTE ON FUNCTION public.resolve_or_for_order(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_or_for_order(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.resolve_or_for_order(uuid, text, text) FROM authenticated;
COMMENT ON FUNCTION public.resolve_or_for_order(uuid, text, text) IS 'INTERNAL: trigger-only helper (SECURITY DEFINER). EXECUTE revoked from PUBLIC/anon/authenticated; not a public RPC.';
-- Les helpers de normalisation restent utilisables (lecture seule, sans fuite de données).
GRANT EXECUTE ON FUNCTION public.norm_or_number(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.norm_plate_key(text) TO authenticated;