-- supplier_doc_profiles : écrit seulement par le serveur (service_role) ; lecture salariés actifs
DROP POLICY IF EXISTS "Authenticated can read supplier doc profiles" ON public.supplier_doc_profiles;
CREATE POLICY "supplier_doc_profiles lecture salaries actifs" ON public.supplier_doc_profiles
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));

-- vehicle_equivalences : référentiel global, lecture salariés actifs, écritures manager (inchangées)
DROP POLICY IF EXISTS "equivalences lecture connectes" ON public.vehicle_equivalences;
CREATE POLICY "equivalences lecture salaries actifs" ON public.vehicle_equivalences
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));

-- communication_settings : paramètres par site
DROP POLICY IF EXISTS "com settings lecture connectes" ON public.communication_settings;
DROP POLICY IF EXISTS "com settings ecriture connectes" ON public.communication_settings;
DROP POLICY IF EXISTS "com settings maj connectes" ON public.communication_settings;
CREATE POLICY "com settings lecture site" ON public.communication_settings
  FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), site_id));
CREATE POLICY "com settings creation site" ON public.communication_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), site_id));
CREATE POLICY "com settings maj site" ON public.communication_settings
  FOR UPDATE TO authenticated
  USING (public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), site_id))
  WITH CHECK (public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), site_id));

-- tire_quotes : site accessible, ou auteur / manager pour les anciens devis sans site
DROP POLICY IF EXISTS "devis pneus lecture connectes" ON public.tire_quotes;
DROP POLICY IF EXISTS "devis pneus creation connectes" ON public.tire_quotes;
DROP POLICY IF EXISTS "devis pneus maj connectes" ON public.tire_quotes;
CREATE POLICY "devis pneus lecture site" ON public.tire_quotes
  FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()) AND (
    public.user_can_access_site(auth.uid(), site_id) OR user_id = auth.uid() OR public.has_role(auth.uid(), 'manager')));
CREATE POLICY "devis pneus creation site" ON public.tire_quotes
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user(auth.uid()) AND user_id = auth.uid()
    AND (site_id IS NULL OR public.user_can_access_site(auth.uid(), site_id)));
CREATE POLICY "devis pneus maj site" ON public.tire_quotes
  FOR UPDATE TO authenticated
  USING (public.is_active_user(auth.uid()) AND (
    public.user_can_access_site(auth.uid(), site_id) OR user_id = auth.uid() OR public.has_role(auth.uid(), 'manager')))
  WITH CHECK (public.is_active_user(auth.uid()) AND (
    public.user_can_access_site(auth.uid(), site_id) OR (site_id IS NULL AND (user_id = auth.uid() OR public.has_role(auth.uid(), 'manager')))));