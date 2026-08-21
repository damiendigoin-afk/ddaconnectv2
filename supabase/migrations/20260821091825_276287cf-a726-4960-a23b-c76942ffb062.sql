ALTER TABLE public.ref_vehicles
  ADD COLUMN IF NOT EXISTS fiscal_power integer,
  ADD COLUMN IF NOT EXISTS weight_kg integer,
  ADD COLUMN IF NOT EXISTS gvw_kg integer,
  ADD COLUMN IF NOT EXISTS curb_weight_kg integer,
  ADD COLUMN IF NOT EXISTS co2_g_km integer,
  ADD COLUMN IF NOT EXISTS source_raw jsonb;

COMMENT ON COLUMN public.ref_vehicles.fiscal_power IS 'Puissance fiscale en CV';
COMMENT ON COLUMN public.ref_vehicles.weight_kg IS 'Masse déclarée (kg) quand la source ne distingue pas PTAC/masse à vide';
COMMENT ON COLUMN public.ref_vehicles.gvw_kg IS 'PTAC (kg)';
COMMENT ON COLUMN public.ref_vehicles.curb_weight_kg IS 'Masse à vide (kg)';
COMMENT ON COLUMN public.ref_vehicles.co2_g_km IS 'Émissions CO2 en g/km';
COMMENT ON COLUMN public.ref_vehicles.source_raw IS 'Valeurs brutes de la source externe (ex. IXELLIO) pour les champs ambigus';