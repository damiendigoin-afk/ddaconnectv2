ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS link_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS detected_plate text;

CREATE INDEX IF NOT EXISTS emails_vehicle_id_idx ON public.emails(vehicle_id);

CREATE TABLE IF NOT EXISTS public.email_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_type text NOT NULL CHECK (match_type IN ('sender','domain','subject')),
  match_value text NOT NULL,
  category text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_type, match_value)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_rules TO authenticated;
GRANT ALL ON public.email_rules TO service_role;

ALTER TABLE public.email_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Utilisateurs actifs lisent les regles de tri"
  ON public.email_rules FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()));

CREATE POLICY "Utilisateurs actifs creent des regles de tri"
  ON public.email_rules FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user(auth.uid()));

CREATE POLICY "Utilisateurs actifs modifient les regles de tri"
  ON public.email_rules FOR UPDATE TO authenticated
  USING (public.is_active_user(auth.uid()))
  WITH CHECK (public.is_active_user(auth.uid()));

CREATE POLICY "Managers suppriment les regles de tri"
  ON public.email_rules FOR DELETE TO authenticated
  USING (public.is_active_user(auth.uid()) AND public.has_role(auth.uid(), 'manager'));

CREATE TRIGGER update_email_rules_updated_at
  BEFORE UPDATE ON public.email_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();