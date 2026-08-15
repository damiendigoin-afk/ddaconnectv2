
CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_number text,
  last_name text,
  first_name text,
  address text,
  address_extra text,
  postal_code text,
  city text,
  phone text,
  mobile text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  plate text NOT NULL,
  plate_normalized text NOT NULL,
  vin text,
  brand text,
  model text,
  first_registration date,
  last_mileage integer,
  last_mileage_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vehicles_plate_norm_idx ON public.vehicles (plate_normalized);

CREATE TABLE public.repair_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  or_number text,
  or_date date,
  client_remarks text,
  requested_work text,
  entry_at timestamptz,
  delivery_at timestamptz,
  mileage_in integer,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX repair_orders_vehicle_idx ON public.repair_orders (vehicle_id);

CREATE TABLE public.vehicle_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_order_id uuid NOT NULL REFERENCES public.repair_orders(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  inspection_type text NOT NULL CHECK (inspection_type IN ('libre','guide')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','completed')),
  current_zone_index integer NOT NULL DEFAULT 1,
  mileage integer,
  share_token uuid NOT NULL DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vehicle_inspections_or_idx ON public.vehicle_inspections (repair_order_id);
CREATE UNIQUE INDEX vehicle_inspections_share_idx ON public.vehicle_inspections (share_token);

CREATE TABLE public.inspection_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES public.vehicle_inspections(id) ON DELETE CASCADE,
  zone_key text NOT NULL,
  zone_label text NOT NULL,
  zone_index integer NOT NULL,
  point_key text NOT NULL,
  point_label text NOT NULL,
  status text NOT NULL DEFAULT 'unset' CHECK (status IN ('unset','ok','watch','defect')),
  measure_value text,
  measure_unit text,
  comment text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inspection_id, point_key)
);

CREATE TABLE public.observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES public.vehicle_inspections(id) ON DELETE CASCADE,
  category text NOT NULL,
  element text NOT NULL,
  status text NOT NULL DEFAULT 'watch' CHECK (status IN ('watch','defect')),
  measure_value text,
  measure_unit text,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid REFERENCES public.vehicle_inspections(id) ON DELETE CASCADE,
  inspection_point_id uuid REFERENCES public.inspection_points(id) ON DELETE CASCADE,
  observation_id uuid REFERENCES public.observations(id) ON DELETE CASCADE,
  repair_order_id uuid REFERENCES public.repair_orders(id) ON DELETE CASCADE,
  media_type text NOT NULL DEFAULT 'photo' CHECK (media_type IN ('photo','video','audio')),
  storage_path text NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.mileage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  inspection_id uuid REFERENCES public.vehicle_inspections(id) ON DELETE SET NULL,
  mileage integer NOT NULL,
  source text NOT NULL DEFAULT 'manuel',
  media_id uuid REFERENCES public.media(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.dms_update_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  inspection_id uuid REFERENCES public.vehicle_inspections(id) ON DELETE CASCADE,
  field text NOT NULL,
  old_value text,
  new_value text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients, public.vehicles, public.repair_orders, public.vehicle_inspections, public.inspection_points, public.observations, public.media, public.mileage_history, public.dms_update_proposals TO anon, authenticated;
GRANT ALL ON public.clients, public.vehicles, public.repair_orders, public.vehicle_inspections, public.inspection_points, public.observations, public.media, public.mileage_history, public.dms_update_proposals TO service_role;

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mileage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dms_update_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open_clients" ON public.clients FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open_vehicles" ON public.vehicles FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open_repair_orders" ON public.repair_orders FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open_vehicle_inspections" ON public.vehicle_inspections FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open_inspection_points" ON public.inspection_points FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open_observations" ON public.observations FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open_media" ON public.media FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open_mileage_history" ON public.mileage_history FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open_dms" ON public.dms_update_proposals FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
