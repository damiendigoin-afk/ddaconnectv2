-- Tables: replace anon-accessible policies with authenticated + active user
DROP POLICY IF EXISTS open_clients ON public.clients;
CREATE POLICY open_clients ON public.clients FOR ALL TO authenticated USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS open_dms ON public.dms_update_proposals;
CREATE POLICY open_dms ON public.dms_update_proposals FOR ALL TO authenticated USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS open_email_logs ON public.email_logs;
CREATE POLICY open_email_logs ON public.email_logs FOR ALL TO authenticated USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS open_inspection_points ON public.inspection_points;
CREATE POLICY open_inspection_points ON public.inspection_points FOR ALL TO authenticated USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS open_media ON public.media;
CREATE POLICY open_media ON public.media FOR ALL TO authenticated USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS open_mileage_history ON public.mileage_history;
CREATE POLICY open_mileage_history ON public.mileage_history FOR ALL TO authenticated USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS open_observations ON public.observations;
CREATE POLICY open_observations ON public.observations FOR ALL TO authenticated USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS open_repair_orders ON public.repair_orders;
CREATE POLICY open_repair_orders ON public.repair_orders FOR ALL TO authenticated USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS open_vehicle_inspections ON public.vehicle_inspections;
CREATE POLICY open_vehicle_inspections ON public.vehicle_inspections FOR ALL TO authenticated USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS open_vehicles ON public.vehicles;
CREATE POLICY open_vehicles ON public.vehicles FOR ALL TO authenticated USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "expertise damages readable" ON public.expertise_damages;
CREATE POLICY "expertise damages readable" ON public.expertise_damages FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "expertise photos readable" ON public.expertise_photos;
CREATE POLICY "expertise photos readable" ON public.expertise_photos FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "expertises readable" ON public.vehicle_expertises;
CREATE POLICY "expertises readable" ON public.vehicle_expertises FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "price rules readable" ON public.repair_price_rules;
CREATE POLICY "price rules readable" ON public.repair_price_rules FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "sites readable by all" ON public.sites;
CREATE POLICY "sites readable by all" ON public.sites FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "field_changes readable" ON public.field_changes;
CREATE POLICY "field_changes readable" ON public.field_changes FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "field_changes insertable" ON public.field_changes;
CREATE POLICY "field_changes insertable" ON public.field_changes FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));

-- Storage: dda-media reserved to authenticated users
DROP POLICY IF EXISTS dda_media_read ON storage.objects;
CREATE POLICY dda_media_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'dda-media');

DROP POLICY IF EXISTS dda_media_insert ON storage.objects;
CREATE POLICY dda_media_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'dda-media');

DROP POLICY IF EXISTS dda_media_update ON storage.objects;
CREATE POLICY dda_media_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'dda-media') WITH CHECK (bucket_id = 'dda-media');

DROP POLICY IF EXISTS dda_media_delete ON storage.objects;
CREATE POLICY dda_media_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'dda-media');
