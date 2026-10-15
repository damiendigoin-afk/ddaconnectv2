ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS contact_email text;
COMMENT ON COLUMN public.sites.contact_email IS 'E-mail de contact du site imprimé sur les documents client (distinct de l''expéditeur technique email_from_address).';
UPDATE public.sites SET contact_email = 'contact@garagecastillon.fr' WHERE code = 'castillon' AND contact_email IS NULL;