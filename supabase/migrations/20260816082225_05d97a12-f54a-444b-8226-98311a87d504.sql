ALTER TABLE public.vehicle_expertises
  ADD COLUMN IF NOT EXISTS market_value numeric,
  ADD COLUMN IF NOT EXISTS buyback_value numeric,
  ADD COLUMN IF NOT EXISTS valuation_comment text;

ALTER TABLE public.expertise_damages
  ADD COLUMN IF NOT EXISTS intervention text,
  ADD COLUMN IF NOT EXISTS element_size text;

ALTER TABLE public.repair_price_rules
  ADD COLUMN IF NOT EXISTS element_size text;

INSERT INTO public.repair_price_rules (site_id, damage_type, action, element_size, label, amount, manual_only, active)
SELECT NULL, NULL, v.action, v.size, v.label, v.amount, v.manual, true
FROM (VALUES
  ('peindre','petit','À peindre — petit élément', 180::numeric, false),
  ('peindre','moyen','À peindre — élément moyen', 300::numeric, false),
  ('peindre','grand','À peindre — grand élément', 450::numeric, false),
  ('reparer_peindre','petit','À réparer & peindre — petit élément', 300::numeric, false),
  ('reparer_peindre','moyen','À réparer & peindre — élément moyen', 500::numeric, false),
  ('reparer_peindre','grand','À réparer & peindre — grand élément', 750::numeric, false),
  ('remplacer','petit','À remplacer — petit élément', NULL::numeric, true),
  ('remplacer','moyen','À remplacer — élément moyen', NULL::numeric, true),
  ('remplacer','grand','À remplacer — grand élément', NULL::numeric, true)
) AS v(action, size, label, amount, manual)
WHERE NOT EXISTS (
  SELECT 1 FROM public.repair_price_rules r
  WHERE r.action = v.action AND r.element_size = v.size AND r.site_id IS NULL
);