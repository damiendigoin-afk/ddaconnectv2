
CREATE POLICY "dda_media_read" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'dda-media');
CREATE POLICY "dda_media_insert" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'dda-media');
CREATE POLICY "dda_media_update" ON storage.objects FOR UPDATE TO anon, authenticated USING (bucket_id = 'dda-media');
CREATE POLICY "dda_media_delete" ON storage.objects FOR DELETE TO anon, authenticated USING (bucket_id = 'dda-media');
