-- 1. Documents de mission : catégorie + origine + nom de fichier
ALTER TABLE public.bodyshop_documents
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'autres',
  ADD COLUMN IF NOT EXISTS origin text,
  ADD COLUMN IF NOT EXISTS file_name text;

-- 2. Traçabilité des tours véhicule
ALTER TABLE public.vehicle_inspections
  ADD COLUMN IF NOT EXISTS duration_seconds integer,
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS completed_by_name text,
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

UPDATE public.vehicle_inspections
   SET duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (completed_at - started_at))::int)
 WHERE completed_at IS NOT NULL AND duration_seconds IS NULL;

DROP TRIGGER IF EXISTS trg_inspections_updated ON public.vehicle_inspections;
CREATE TRIGGER trg_inspections_updated
  BEFORE UPDATE ON public.vehicle_inspections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Seuils paramétrables (préparation contrôle de durée / productivité)
CREATE TABLE IF NOT EXISTS public.metric_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id),
  metric_key text NOT NULL,
  min_value numeric,
  target_value numeric,
  max_value numeric,
  unit text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (site_id, metric_key)
);

GRANT SELECT ON public.metric_thresholds TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.metric_thresholds TO authenticated;
GRANT ALL ON public.metric_thresholds TO service_role;
ALTER TABLE public.metric_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "metric_thresholds_select" ON public.metric_thresholds
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "metric_thresholds_write" ON public.metric_thresholds
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'manager'));

DROP TRIGGER IF EXISTS trg_metric_thresholds_updated ON public.metric_thresholds;
CREATE TRIGGER trg_metric_thresholds_updated
  BEFORE UPDATE ON public.metric_thresholds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Identité réelle + droits par module
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text;

CREATE TABLE IF NOT EXISTS public.user_module_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  allowed boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, module_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_module_access TO authenticated;
GRANT ALL ON public.user_module_access TO service_role;
ALTER TABLE public.user_module_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "module_access_self_select" ON public.user_module_access
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'manager'));
CREATE POLICY "module_access_manager_write" ON public.user_module_access
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'manager'));

DROP TRIGGER IF EXISTS trg_module_access_updated ON public.user_module_access;
CREATE TRIGGER trg_module_access_updated
  BEFORE UPDATE ON public.user_module_access
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Purge des seuls brouillons temporaires (7 jours depuis la dernière modification)
CREATE OR REPLACE FUNCTION public.purge_stale_drafts(_days integer DEFAULT 7)
RETURNS TABLE (inspections_deleted integer, returns_deleted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_insp integer := 0;
  v_ret integer := 0;
  v_cut timestamptz := now() - make_interval(days => GREATEST(_days, 1));
BEGIN
  WITH doomed AS (
    SELECT i.id
      FROM public.vehicle_inspections i
     WHERE i.status <> 'completed'
       AND i.completed_at IS NULL
       AND GREATEST(i.updated_at, i.started_at, i.created_at) < v_cut
       AND NOT EXISTS (SELECT 1 FROM public.media m WHERE m.inspection_id = i.id)
  ), d1 AS (
    DELETE FROM public.inspection_points p USING doomed d WHERE p.inspection_id = d.id RETURNING 1
  ), d2 AS (
    DELETE FROM public.observations o USING doomed d WHERE o.inspection_id = d.id RETURNING 1
  ), d3 AS (
    DELETE FROM public.vehicle_inspections i USING doomed d WHERE i.id = d.id RETURNING 1
  )
  SELECT count(*)::int INTO v_insp FROM d3;

  WITH doomedr AS (
    SELECT r.id
      FROM public.part_returns r
     WHERE r.status = 'brouillon'
       AND r.updated_at < v_cut
       AND coalesce(array_length(r.photos, 1), 0) = 0
       AND NOT EXISTS (SELECT 1 FROM public.part_return_lines l WHERE l.return_id = r.id)
  ), r1 AS (
    DELETE FROM public.part_returns r USING doomedr d WHERE r.id = d.id RETURNING 1
  )
  SELECT count(*)::int INTO v_ret FROM r1;

  RETURN QUERY SELECT v_insp, v_ret;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_stale_drafts(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.purge_stale_drafts(integer) TO service_role;