ALTER TABLE public.part_orders ADD COLUMN IF NOT EXISTS order_date date;
COMMENT ON COLUMN public.part_orders.order_date IS 'Date de commande fournisseur (document ou saisie ; défaut date du jour).';