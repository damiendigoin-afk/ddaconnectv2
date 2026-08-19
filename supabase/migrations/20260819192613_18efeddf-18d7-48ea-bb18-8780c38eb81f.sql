CREATE TABLE public.crm_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  reference text,
  channel text NOT NULL DEFAULT 'telephone',
  subject text NOT NULL,
  body text,
  customer_name text,
  customer_phone text,
  customer_email text,
  plate text,
  vehicle_id uuid,
  priority text NOT NULL DEFAULT 'normale',
  status text NOT NULL DEFAULT 'nouvelle',
  outcome text,
  outcome_note text,
  assignee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assignee_name text,
  escalation_level int NOT NULL DEFAULT 0,
  due_at timestamptz,
  last_action_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.crm_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.crm_requests(id) ON DELETE CASCADE,
  kind text NOT NULL,
  message text,
  actor_id uuid,
  actor_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX crm_requests_status_idx ON public.crm_requests(status);
CREATE INDEX crm_requests_assignee_idx ON public.crm_requests(assignee_id);
CREATE INDEX crm_request_events_request_idx ON public.crm_request_events(request_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_requests TO authenticated;
GRANT ALL ON public.crm_requests TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_request_events TO authenticated;
GRANT ALL ON public.crm_request_events TO service_role;

ALTER TABLE public.crm_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_request_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_requests_read" ON public.crm_requests FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "crm_requests_insert" ON public.crm_requests FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "crm_requests_update" ON public.crm_requests FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "crm_requests_delete" ON public.crm_requests FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'manager'));

CREATE POLICY "crm_events_read" ON public.crm_request_events FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "crm_events_insert" ON public.crm_request_events FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "crm_events_delete" ON public.crm_request_events FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'manager'));

CREATE TRIGGER crm_requests_updated_at BEFORE UPDATE ON public.crm_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();