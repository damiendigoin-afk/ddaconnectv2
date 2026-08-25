-- 1. Rôles : lecture restreinte
DROP POLICY IF EXISTS "roles readable by authenticated" ON public.user_roles;
CREATE POLICY "roles readable by self or manager" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'manager'));

-- 2. Référentiels internes : lecture réservée aux comptes actifs (groupe entier)
DROP POLICY IF EXISTS "operators readable by authenticated" ON public.winmotor_operators;
CREATE POLICY "operators readable by active users" ON public.winmotor_operators
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "prod imports readable by authenticated" ON public.productivity_imports;
CREATE POLICY "prod imports readable by active users" ON public.productivity_imports
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "templates_select_authenticated" ON public.message_templates;
CREATE POLICY "templates_select_active" ON public.message_templates
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "ai_budget_read" ON public.ai_budget_settings;
CREATE POLICY "ai_budget_read_active" ON public.ai_budget_settings
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "tire_brand_tiers_select" ON public.tire_brand_tiers;
CREATE POLICY "tire_brand_tiers_select_active" ON public.tire_brand_tiers
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));

-- 3. Offres pneus : lecture/écriture réservées aux comptes actifs
DROP POLICY IF EXISTS "tire_quote_offers_select" ON public.tire_quote_offers;
CREATE POLICY "tire_quote_offers_select_active" ON public.tire_quote_offers
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "tire_quote_offers_insert" ON public.tire_quote_offers;
CREATE POLICY "tire_quote_offers_insert_active" ON public.tire_quote_offers
  FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "tire_quote_offers_update" ON public.tire_quote_offers;
CREATE POLICY "tire_quote_offers_update_active" ON public.tire_quote_offers
  FOR UPDATE TO authenticated
  USING (public.is_active_user(auth.uid()))
  WITH CHECK (public.is_active_user(auth.uid()));

-- 4. Expertises : création / modification réservées aux comptes actifs
DROP POLICY IF EXISTS "expertises insert" ON public.vehicle_expertises;
CREATE POLICY "expertises insert active" ON public.vehicle_expertises
  FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "expertises update" ON public.vehicle_expertises;
CREATE POLICY "expertises update active" ON public.vehicle_expertises
  FOR UPDATE TO authenticated
  USING (public.is_active_user(auth.uid()))
  WITH CHECK (public.is_active_user(auth.uid()));

-- 5. Photos et dommages d'expertise
DROP POLICY IF EXISTS "expertise photos write" ON public.expertise_photos;
CREATE POLICY "expertise photos insert active" ON public.expertise_photos
  FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "expertise photos update" ON public.expertise_photos;
CREATE POLICY "expertise photos update active" ON public.expertise_photos
  FOR UPDATE TO authenticated
  USING (public.is_active_user(auth.uid()))
  WITH CHECK (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "expertise photos delete" ON public.expertise_photos;
CREATE POLICY "expertise photos delete owner or manager" ON public.expertise_photos
  FOR DELETE TO authenticated
  USING (
    public.is_active_user(auth.uid())
    AND (
      public.has_role(auth.uid(), 'manager')
      OR EXISTS (
        SELECT 1 FROM public.vehicle_expertises e
        WHERE e.id = expertise_photos.expertise_id AND e.created_by = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "expertise damages insert" ON public.expertise_damages;
CREATE POLICY "expertise damages insert active" ON public.expertise_damages
  FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "expertise damages update" ON public.expertise_damages;
CREATE POLICY "expertise damages update active" ON public.expertise_damages
  FOR UPDATE TO authenticated
  USING (public.is_active_user(auth.uid()))
  WITH CHECK (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "expertise damages delete" ON public.expertise_damages;
CREATE POLICY "expertise damages delete owner or manager" ON public.expertise_damages
  FOR DELETE TO authenticated
  USING (
    public.is_active_user(auth.uid())
    AND (
      public.has_role(auth.uid(), 'manager')
      OR expertise_damages.created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.vehicle_expertises e
        WHERE e.id = expertise_damages.expertise_id AND e.created_by = auth.uid()
      )
    )
  );

-- 6. Traçabilité automatique des écritures sensibles
CREATE OR REPLACE FUNCTION public.log_sensitive_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity text := TG_ARGV[0];
  v_id uuid;
  v_old jsonb;
  v_new jsonb;
  k text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_id := OLD.id;
    INSERT INTO public.field_changes (entity_type, entity_id, field, old_value, new_value, changed_by)
    VALUES (v_entity, v_id, '__deleted__', to_jsonb(OLD)::text, NULL, auth.uid());
    RETURN OLD;
  END IF;

  v_id := NEW.id;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.field_changes (entity_type, entity_id, field, old_value, new_value, changed_by)
    VALUES (v_entity, v_id, '__created__', NULL, to_jsonb(NEW)::text, auth.uid());
    RETURN NEW;
  END IF;

  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);
  FOR k IN SELECT jsonb_object_keys(v_new) LOOP
    IF k NOT IN ('updated_at') AND (v_old -> k) IS DISTINCT FROM (v_new -> k) THEN
      INSERT INTO public.field_changes (entity_type, entity_id, field, old_value, new_value, changed_by)
      VALUES (v_entity, v_id, k, v_old ->> k, v_new ->> k, auth.uid());
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.log_sensitive_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit_vehicle_expertises ON public.vehicle_expertises;
CREATE TRIGGER trg_audit_vehicle_expertises
  AFTER INSERT OR UPDATE OR DELETE ON public.vehicle_expertises
  FOR EACH ROW EXECUTE FUNCTION public.log_sensitive_change('expertise');

DROP TRIGGER IF EXISTS trg_audit_expertise_damages ON public.expertise_damages;
CREATE TRIGGER trg_audit_expertise_damages
  AFTER INSERT OR UPDATE OR DELETE ON public.expertise_damages
  FOR EACH ROW EXECUTE FUNCTION public.log_sensitive_change('expertise_damage');

DROP TRIGGER IF EXISTS trg_audit_expertise_photos ON public.expertise_photos;
CREATE TRIGGER trg_audit_expertise_photos
  AFTER INSERT OR UPDATE OR DELETE ON public.expertise_photos
  FOR EACH ROW EXECUTE FUNCTION public.log_sensitive_change('expertise_photo');

DROP TRIGGER IF EXISTS trg_audit_tire_quote_offers ON public.tire_quote_offers;
CREATE TRIGGER trg_audit_tire_quote_offers
  AFTER INSERT OR UPDATE OR DELETE ON public.tire_quote_offers
  FOR EACH ROW EXECUTE FUNCTION public.log_sensitive_change('tire_quote_offer');

-- 7. Fonctions SECURITY DEFINER : pas d'exécution publique
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_active_user(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.storage_object_owned(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_storage_stats() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purge_stale_drafts(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_single_inspection_per_order() FROM PUBLIC, anon, authenticated;