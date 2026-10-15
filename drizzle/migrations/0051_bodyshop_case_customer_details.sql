ALTER TABLE public.bodyshop_cases ADD COLUMN IF NOT EXISTS customer_account text, ADD COLUMN IF NOT EXISTS customer_address text;
COMMENT ON COLUMN public.bodyshop_cases.customer_account IS 'N° compte client WinMotor lu sur l''OR (contrôlé à la création du dossier)';
COMMENT ON COLUMN public.bodyshop_cases.customer_address IS 'Adresse client lue sur l''OR (contrôlée à la création du dossier)';