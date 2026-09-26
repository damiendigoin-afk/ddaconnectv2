-- C1 correctifs : droits = menu (manager toléré), identité OR stricte site + n°, versionnage ciblé, sortie finale bornée au restant affecté.
CREATE OR REPLACE FUNCTION public.wm_can_import(_site uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), _site)
    AND (EXISTS (SELECT 1 FROM public.user_module_access a WHERE a.user_id = auth.uid() AND a.allowed AND a.module_key = 'parametrage')
         OR public.has_role(auth.uid(),'manager'));
$$;

CREATE OR REPLACE FUNCTION public.wm_find_or(_site uuid, _num text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.repair_orders WHERE site_id = _site AND or_number = NULLIF(_num,'') ORDER BY created_at LIMIT 1;
$$;

DO $$
DECLARE src text;
BEGIN
  -- Entêtes : type client aligné sur l'existant + recherche d'OR stricte (site + n°).
  src := pg_get_functiondef('public.wm_import_headers(uuid,uuid,jsonb)'::regprocedure);
  src := replace(src, '''PARTICULIER''', '''individual''');
  src := replace(src, 'SELECT id INTO v_or FROM public.repair_orders WHERE or_number = r->>''or'' AND (site_id = _site OR site_id IS NULL) ORDER BY (site_id = _site) DESC NULLS LAST LIMIT 1;', 'v_or := public.wm_find_or(_site, r->>''or'');');
  EXECUTE src;

  src := pg_get_functiondef('public.wm_import_details(uuid,uuid,jsonb)'::regprocedure);
  src := replace(src, 'SELECT id INTO v_or FROM public.repair_orders WHERE or_number = i->>''or'' AND (site_id = _site OR site_id IS NULL) ORDER BY (site_id = _site) DESC NULLS LAST LIMIT 1;', 'v_or := public.wm_find_or(_site, i->>''or'');');
  -- Seules les lignes actives de CETTE facture sont remplacées, seuls leurs liens passent « à revoir ».
  src := replace(src,
    'UPDATE public.winmotor_invoice_lines SET active = false, superseded_at = now() WHERE invoice_id = v_id AND active;
        -- Rapprochements des anciennes lignes : à revoir (aucun mouvement de stock annulé automatiquement).
        UPDATE public.winmotor_reconciliation_links SET status = ''stale'' WHERE status = ''active'' AND invoice_line_id IN (SELECT id FROM public.winmotor_invoice_lines WHERE invoice_id = v_id AND NOT active);',
    'WITH sup AS (UPDATE public.winmotor_invoice_lines SET active = false, superseded_at = now() WHERE invoice_id = v_id AND active RETURNING id)
        UPDATE public.winmotor_reconciliation_links SET status = ''stale'' WHERE status = ''active'' AND invoice_line_id IN (SELECT id FROM sup);');
  IF position('WITH sup AS' in src) = 0 OR position('wm_find_or' in src) = 0 THEN RAISE EXCEPTION 'Patch wm_import_details non appliqué'; END IF;
  EXECUTE src;
END $$;

CREATE OR REPLACE FUNCTION public.wm_link_orders(_site uuid, _mirror_since date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_veh uuid; v_or uuid; v_linked int := 0; v_mirrored int := 0; v_skipped int := 0;
BEGIN
  IF NOT public.wm_can_import(_site) THEN RAISE EXCEPTION 'Non autorisé'; END IF;
  UPDATE public.winmotor_invoices w SET repair_order_id = public.wm_find_or(_site, w.or_number)
   WHERE w.site_id = _site AND w.repair_order_id IS NULL AND w.or_number IS NOT NULL AND public.wm_find_or(_site, w.or_number) IS NOT NULL;
  GET DIAGNOSTICS v_linked = ROW_COUNT;
  FOR r IN SELECT DISTINCT ON (or_number) or_number, invoice_date, plate, plate_normalized, vin, ref_vehicle_id
             FROM public.winmotor_invoices WHERE site_id = _site AND repair_order_id IS NULL AND or_number IS NOT NULL AND invoice_date >= _mirror_since AND plate_normalized IS NOT NULL
             ORDER BY or_number, invoice_date LOOP
    -- Ne jamais dupliquer un OR existant de même numéro sans site renseigné : laissé à vérifier.
    IF EXISTS (SELECT 1 FROM public.repair_orders WHERE or_number = r.or_number AND site_id IS NULL) THEN v_skipped := v_skipped + 1; CONTINUE; END IF;
    SELECT id INTO v_veh FROM public.vehicles WHERE plate_normalized = r.plate_normalized ORDER BY created_at LIMIT 1;
    IF v_veh IS NULL THEN
      INSERT INTO public.vehicles (plate, plate_normalized, vin, brand, model)
      SELECT COALESCE(r.plate, r.plate_normalized), r.plate_normalized, r.vin, rv.brand, rv.model FROM (SELECT 1) x LEFT JOIN public.ref_vehicles rv ON rv.id = r.ref_vehicle_id
      RETURNING id INTO v_veh;
    END IF;
    INSERT INTO public.repair_orders (vehicle_id, or_number, or_date, site_id, record_type, or_status, or_source, or_linked_at, status, created_by_name)
    VALUES (v_veh, r.or_number, r.invoice_date, _site, 'or_winmotor', 'or_complet', 'winmotor_import', now(), 'closed', 'Import WinMotor (miroir)')
    RETURNING id INTO v_or;
    UPDATE public.winmotor_invoices SET repair_order_id = v_or WHERE site_id = _site AND or_number = r.or_number AND repair_order_id IS NULL;
    v_mirrored := v_mirrored + 1;
  END LOOP;
  RETURN jsonb_build_object('linked', v_linked, 'mirrored', v_mirrored, 'skipped_ambiguous', v_skipped);
END $$;

CREATE OR REPLACE FUNCTION public.wm_link_usage(_line uuid, _usage uuid, _qty numeric, _method text, _rule text, _user_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; u record; v_linked_line numeric; v_linked_usage numeric; v_sold numeric; v_sale numeric; v_link uuid; v_mv uuid;
BEGIN
  SELECT wl.id, wl.site_id, wl.active, wl.qty, wi.doc_kind, wi.repair_order_id AS inv_or INTO l
    FROM public.winmotor_invoice_lines wl JOIN public.winmotor_invoices wi ON wi.id = wl.invoice_id WHERE wl.id = _line FOR UPDATE OF wl;
  IF l.id IS NULL OR NOT l.active THEN RAISE EXCEPTION 'Ligne de facture introuvable ou remplacée'; END IF;
  IF NOT (public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), l.site_id)) THEN RAISE EXCEPTION 'Non autorisé'; END IF;
  IF l.doc_kind = 'preinvoice' THEN RAISE EXCEPTION 'Une préfacture ne peut pas justifier une sortie définitive'; END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'Quantité invalide'; END IF;
  IF COALESCE(l.qty,0) <= 0 THEN RAISE EXCEPTION 'Ligne négative/avoir : utiliser le traitement des avoirs'; END IF;
  SELECT id, site_id, repair_order_id, article_id, qty_allocated, qty_used INTO u FROM public.or_part_usage WHERE id = _usage FOR UPDATE;
  IF u.id IS NULL THEN RAISE EXCEPTION 'Pièce DDA introuvable'; END IF;
  IF u.site_id IS DISTINCT FROM l.site_id THEN RAISE EXCEPTION 'Site différent : rapprochement refusé'; END IF;
  IF l.inv_or IS DISTINCT FROM u.repair_order_id THEN RAISE EXCEPTION 'OR différent : rapprochement refusé'; END IF;
  SELECT COALESCE(SUM(k.qty),0) INTO v_linked_line FROM public.winmotor_reconciliation_links k WHERE k.invoice_line_id = _line AND k.status = 'active';
  SELECT COALESCE(SUM(k.qty),0) INTO v_linked_usage FROM public.winmotor_reconciliation_links k WHERE k.usage_id = _usage AND k.status = 'active';
  IF _qty > l.qty - v_linked_line OR _qty > COALESCE(u.qty_used, u.qty_allocated) - v_linked_usage THEN
    RAISE EXCEPTION 'Quantité supérieure au restant (facture % / DDA %)', l.qty - v_linked_line, COALESCE(u.qty_used, u.qty_allocated) - v_linked_usage;
  END IF;
  INSERT INTO public.winmotor_reconciliation_links (site_id, invoice_line_id, usage_id, article_id, link_kind, qty, method, rule, created_by_name)
  VALUES (l.site_id, _line, _usage, u.article_id, 'or_usage', _qty, COALESCE(_method,'manual'), NULLIF(_rule,''), _user_name) RETURNING id INTO v_link;
  -- Sortie définitive bornée au restant affecté de cette pièce (jamais sous zéro, jamais deux fois par lien).
  IF u.article_id IS NOT NULL AND u.qty_allocated > 0 THEN
    SELECT COALESCE(SUM(-m.delta_allocated),0) INTO v_sold FROM public.stock_movements m JOIN public.winmotor_reconciliation_links k ON k.id = m.reconciliation_link_id WHERE k.usage_id = _usage AND m.movement_type = 'or_sale_final';
    v_sale := LEAST(_qty, u.qty_allocated - v_sold);
    IF v_sale > 0 THEN
      INSERT INTO public.stock_movements (site_id, article_id, movement_type, qty, delta_available, delta_allocated, delta_quarantine, repair_order_id, reason, created_by_name, reconciliation_link_id)
      VALUES (l.site_id, u.article_id, 'or_sale_final', v_sale, 0, -v_sale, 0, u.repair_order_id, 'Facturée WinMotor', _user_name, v_link)
      RETURNING id INTO v_mv;
      UPDATE public.winmotor_reconciliation_links SET sale_movement_id = v_mv WHERE id = v_link;
    END IF;
  END IF;
  RETURN v_link;
END $$;

CREATE OR REPLACE FUNCTION public.wm_store_sale(_line uuid, _article uuid, _qty numeric, _user_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; v_site uuid; v_linked numeric; v_link uuid; v_mv uuid;
BEGIN
  SELECT wl.id, wl.site_id, wl.active, wl.qty, wi.doc_kind INTO l FROM public.winmotor_invoice_lines wl JOIN public.winmotor_invoices wi ON wi.id = wl.invoice_id WHERE wl.id = _line FOR UPDATE OF wl;
  IF l.id IS NULL OR NOT l.active THEN RAISE EXCEPTION 'Ligne introuvable'; END IF;
  IF NOT (public.is_active_user(auth.uid()) AND public.user_can_access_site(auth.uid(), l.site_id)) THEN RAISE EXCEPTION 'Non autorisé'; END IF;
  IF l.doc_kind = 'preinvoice' THEN RAISE EXCEPTION 'Préfacture : sortie refusée'; END IF;
  SELECT site_id INTO v_site FROM public.stock_articles WHERE id = _article;
  IF v_site IS DISTINCT FROM l.site_id THEN RAISE EXCEPTION 'Site différent'; END IF;
  SELECT COALESCE(SUM(k.qty),0) INTO v_linked FROM public.winmotor_reconciliation_links k WHERE k.invoice_line_id = _line AND k.status = 'active';
  IF _qty IS NULL OR _qty <= 0 OR _qty > COALESCE(l.qty,0) - v_linked THEN RAISE EXCEPTION 'Quantité supérieure au restant (%)', COALESCE(l.qty,0) - v_linked; END IF;
  INSERT INTO public.winmotor_reconciliation_links (site_id, invoice_line_id, article_id, link_kind, qty, method, rule, created_by_name)
  VALUES (l.site_id, _line, _article, 'store_sale', _qty, 'manual', 'vente_magasin', _user_name) RETURNING id INTO v_link;
  INSERT INTO public.stock_movements (site_id, article_id, movement_type, qty, delta_available, delta_allocated, delta_quarantine, reason, created_by_name, reconciliation_link_id)
  VALUES (l.site_id, _article, 'store_sale_final', _qty, -_qty, 0, 0, 'Vente magasin facturée WinMotor (confirmée)', _user_name, v_link) RETURNING id INTO v_mv;
  UPDATE public.winmotor_reconciliation_links SET sale_movement_id = v_mv WHERE id = v_link;
  RETURN v_link;
END $$;

REVOKE EXECUTE ON FUNCTION public.wm_find_or(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wm_find_or(uuid,text) TO authenticated;