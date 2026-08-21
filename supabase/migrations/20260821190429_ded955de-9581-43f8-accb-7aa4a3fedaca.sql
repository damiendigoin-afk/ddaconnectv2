UPDATE public.paint_element_rules
SET dr_operations = (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('code', op->>'code', 'label', op->>'label', 'hours', NULL::jsonb)), '[]'::jsonb)
  FROM jsonb_array_elements(dr_operations) AS op
),
updated_at = now()
WHERE jsonb_array_length(dr_operations) > 0;

UPDATE public.commercial_settings
SET margin_pct = 0, min_margin_ht = 0, updated_at = now();