CREATE OR REPLACE FUNCTION public.finish_or_work(_or uuid, _site uuid, _forced boolean, _reason text, _user_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _pending int;
  _bad int;
  _closed int := 0;
  _cur text;
  _mgr boolean;
BEGIN
  IF _uid IS NULL OR NOT is_active_user(_uid) OR NOT user_can_access_site(_uid, _site) THEN
    RAISE EXCEPTION 'Accès refusé à ce site';
  END IF;
  PERFORM 1 FROM repair_orders WHERE id = _or FOR UPDATE;
  SELECT state INTO _cur FROM or_work_state WHERE repair_order_id = _or;
  IF _cur = 'travaux_termines' THEN
    RETURN jsonb_build_object('already', true, 'closed_sessions', 0);
  END IF;
  SELECT count(*) FILTER (WHERE usage_status = 'pending'),
         count(*) FILTER (WHERE usage_status = 'not_used' AND coalesce(btrim(reason), '') = '' AND coalesce(btrim(comment), '') = '')
    INTO _pending, _bad FROM or_part_usage WHERE repair_order_id = _or;
  IF (_pending + _bad) > 0 THEN
    _mgr := EXISTS (SELECT 1 FROM user_roles WHERE user_id = _uid AND role = 'manager');
    IF NOT coalesce(_forced, false) THEN
      RAISE EXCEPTION 'Pièces à pointer : % ligne(s) non traitée(s)', _pending + _bad;
    END IF;
    IF NOT _mgr THEN
      RAISE EXCEPTION 'Clôture forcée réservée à un manager';
    END IF;
  END IF;
  UPDATE work_time_sessions SET stopped_at = now()
   WHERE repair_order_id = _or AND stopped_at IS NULL;
  GET DIAGNOSTICS _closed = ROW_COUNT;
  INSERT INTO or_work_state (repair_order_id, site_id, state, finished_at, finished_by, finished_by_name, forced, force_reason, updated_at)
  VALUES (_or, _site, 'travaux_termines', now(), _uid, _user_name, (_pending + _bad) > 0, _reason, now())
  ON CONFLICT (repair_order_id) DO UPDATE SET state = 'travaux_termines', finished_at = now(), finished_by = _uid,
    finished_by_name = _user_name, forced = EXCLUDED.forced, force_reason = EXCLUDED.force_reason, updated_at = now();
  INSERT INTO parts_events (site_id, entity, entity_id, repair_order_id, action, detail, created_by, created_by_name)
  VALUES (_site, 'or', _or, _or, CASE WHEN (_pending + _bad) > 0 THEN 'work_done_forced' ELSE 'work_done' END,
    jsonb_build_object('closed_sessions', _closed, 'pending', _pending + _bad, 'reason', _reason), _uid, _user_name);
  RETURN jsonb_build_object('already', false, 'closed_sessions', _closed, 'forced', (_pending + _bad) > 0, 'pending', _pending + _bad);
END $$;

CREATE OR REPLACE FUNCTION public.resume_or_work(_or uuid, _site uuid, _user_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _cur text;
BEGIN
  IF _uid IS NULL OR NOT is_active_user(_uid) OR NOT user_can_access_site(_uid, _site) THEN
    RAISE EXCEPTION 'Accès refusé à ce site';
  END IF;
  SELECT state INTO _cur FROM or_work_state WHERE repair_order_id = _or FOR UPDATE;
  IF _cur IS NULL OR _cur = 'en_cours' THEN
    RETURN jsonb_build_object('already', true);
  END IF;
  UPDATE or_work_state SET state = 'en_cours', updated_at = now() WHERE repair_order_id = _or;
  INSERT INTO parts_events (site_id, entity, entity_id, repair_order_id, action, detail, created_by, created_by_name)
  VALUES (_site, 'or', _or, _or, 'work_resumed', jsonb_build_object('previous_state', _cur), _uid, _user_name);
  RETURN jsonb_build_object('already', false);
END $$;

REVOKE EXECUTE ON FUNCTION public.finish_or_work(uuid, uuid, boolean, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resume_or_work(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_or_work(uuid, uuid, boolean, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_or_work(uuid, uuid, text) TO authenticated;