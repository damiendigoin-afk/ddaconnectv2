CREATE TABLE public.tour_notification_recipients (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references public.sites(id) on delete cascade,
  email text not null,
  label text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
CREATE UNIQUE INDEX tour_notif_recipients_uniq ON public.tour_notification_recipients (coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(email));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tour_notification_recipients TO authenticated;
GRANT ALL ON public.tour_notification_recipients TO service_role;
ALTER TABLE public.tour_notification_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recipients readable by active users" ON public.tour_notification_recipients FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "recipients managed by managers" ON public.tour_notification_recipients FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'manager'));
CREATE TRIGGER trg_tour_notif_recipients_updated BEFORE UPDATE ON public.tour_notification_recipients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.tour_notifications (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.vehicle_inspections(id) on delete cascade,
  recipients text[] not null default '{}',
  status text not null default 'pending',
  error_message text,
  photo_count integer not null default 0,
  sent_at timestamptz,
  triggered_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
CREATE INDEX tour_notifications_inspection_idx ON public.tour_notifications (inspection_id, created_at desc);
GRANT SELECT, INSERT, UPDATE ON public.tour_notifications TO authenticated;
GRANT ALL ON public.tour_notifications TO service_role;
ALTER TABLE public.tour_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tour notifications readable by active users" ON public.tour_notifications FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "tour notifications insert by active users" ON public.tour_notifications FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "tour notifications update by managers" ON public.tour_notifications FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'manager'));
CREATE TRIGGER trg_tour_notifications_updated BEFORE UPDATE ON public.tour_notifications FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();