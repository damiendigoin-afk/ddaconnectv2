ALTER TABLE public.part_orders DROP CONSTRAINT IF EXISTS part_orders_status_check;
ALTER TABLE public.part_orders ADD CONSTRAINT part_orders_status_check CHECK (status = ANY (ARRAY['to_transmit'::text,'ordered'::text,'partial'::text,'received'::text,'cancelled'::text]));
ALTER TABLE public.part_orders ADD COLUMN IF NOT EXISTS supplier_account text;
ALTER TABLE public.part_orders ADD COLUMN IF NOT EXISTS transmission_mode text NOT NULL DEFAULT 'manual';
ALTER TABLE public.part_orders ADD COLUMN IF NOT EXISTS source_quote jsonb;
ALTER TABLE public.part_orders ADD COLUMN IF NOT EXISTS supplier_confirmed_at timestamptz;
ALTER TABLE public.part_orders ADD COLUMN IF NOT EXISTS supplier_confirmed_by_name text;
COMMENT ON COLUMN public.part_orders.transmission_mode IS 'manual = validation humaine sur portail fournisseur ; reserve futur connecteur automatique documente';

CREATE OR REPLACE FUNCTION public.guard_part_order_transmit()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  -- Passage « à transmettre » -> « commandée » uniquement avec un n° de commande fournisseur réel.
  IF TG_OP = 'UPDATE' AND OLD.status = 'to_transmit' AND NEW.status = 'ordered'
     AND NULLIF(btrim(COALESCE(NEW.supplier_order_ref, '')), '') IS NULL THEN
    RAISE EXCEPTION 'SUPPLIER_REF_REQUIRED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_part_order_transmit ON public.part_orders;
CREATE TRIGGER trg_guard_part_order_transmit BEFORE UPDATE ON public.part_orders
FOR EACH ROW EXECUTE FUNCTION public.guard_part_order_transmit();