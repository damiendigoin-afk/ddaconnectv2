ALTER TABLE public.tire_quotes
  ADD COLUMN IF NOT EXISTS margin_adjustment_pct numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.tire_quotes.margin_adjustment_pct IS
  'Position du levier de marge au moment du devis, en % appliqué à la marge standard (-50 à +100, 0 = standard).';