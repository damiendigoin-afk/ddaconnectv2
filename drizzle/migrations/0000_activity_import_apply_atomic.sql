CREATE OR REPLACE FUNCTION public.activity_import_apply(
  p_site text,
  p_file_name text,
  p_user uuid,
  p_user_name text,
  p_anomalies jsonb,
  p_months jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_import_id uuid;
  v_month jsonb;
  v_month_id uuid;
  v_manual boolean;
  v_values_count integer := 0;
BEGIN
  IF p_site NOT IN ('dda', 'castillon') THEN
    RAISE EXCEPTION 'Société inconnue: %', p_site;
  END IF;
  IF jsonb_typeof(p_months) <> 'array' OR jsonb_array_length(p_months) = 0 THEN
    RAISE EXCEPTION 'Aucun mois à enregistrer';
  END IF;

  INSERT INTO public.activity_imports (site_code, file_name, imported_by, imported_by_name, months_count, values_count, anomalies)
  VALUES (p_site, p_file_name, p_user, p_user_name, jsonb_array_length(p_months), 0, COALESCE(p_anomalies, '[]'::jsonb))
  RETURNING id INTO v_import_id;

  FOR v_month IN SELECT * FROM jsonb_array_elements(p_months)
  LOOP
    INSERT INTO public.activity_months (site_code, period_start, sheet_name, import_id, status, updated_at)
    VALUES (
      p_site,
      (v_month->>'period_start')::date,
      v_month->>'sheet_name',
      v_import_id,
      COALESCE(v_month->>'status', 'provisoire'),
      now()
    )
    ON CONFLICT (site_code, period_start) DO UPDATE
      SET sheet_name = EXCLUDED.sheet_name,
          import_id = EXCLUDED.import_id,
          status = CASE WHEN public.activity_months.status_manual THEN public.activity_months.status ELSE EXCLUDED.status END,
          updated_at = now()
    RETURNING id, status_manual INTO v_month_id, v_manual;

    DELETE FROM public.activity_values WHERE month_id = v_month_id;

    INSERT INTO public.activity_values (month_id, indicator_key, value)
    SELECT v_month_id, kv.key,
           CASE WHEN jsonb_typeof(kv.value) = 'number' THEN (kv.value)::text::numeric ELSE NULL END
    FROM jsonb_each(COALESCE(v_month->'values', '{}'::jsonb)) AS kv;

    v_values_count := v_values_count + (SELECT count(*) FROM jsonb_object_keys(COALESCE(v_month->'values', '{}'::jsonb)));
  END LOOP;

  UPDATE public.activity_imports SET values_count = v_values_count WHERE id = v_import_id;

  RETURN v_import_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.activity_import_apply(text, text, uuid, text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activity_import_apply(text, text, uuid, text, jsonb, jsonb) TO service_role;