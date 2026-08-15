-- SITES
CREATE TABLE public.sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email_from_name text NOT NULL DEFAULT 'Damien Digoin Automobile',
  email_from_address text NOT NULL DEFAULT 'contact@garagecastillon.fr',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sites TO anon;
GRANT SELECT, INSERT, UPDATE ON public.sites TO authenticated;
GRANT ALL ON public.sites TO service_role;
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;

INSERT INTO public.sites (name, is_default) VALUES ('Damien Digoin Automobile', true);

-- ROLES
CREATE TYPE public.app_role AS ENUM ('manager', 'salarie', 'client');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  first_name text,
  last_name text,
  avatar_url text,
  status text NOT NULL DEFAULT 'pending',
  site_id uuid REFERENCES public.sites(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_active_user(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND status = 'active')
$$;

-- policies
CREATE POLICY "sites readable by all" ON public.sites FOR SELECT USING (true);
CREATE POLICY "managers manage sites" ON public.sites FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'manager'));
CREATE POLICY "managers create sites" ON public.sites FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'manager'));

CREATE POLICY "profiles readable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "managers update any profile" ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'manager'));

CREATE POLICY "roles readable by authenticated" ON public.user_roles FOR SELECT TO authenticated USING (true);

GRANT INSERT, DELETE ON public.user_roles TO authenticated;
CREATE POLICY "managers grant roles" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'manager'));
CREATE POLICY "managers revoke roles" ON public.user_roles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'manager'));

-- new user trigger: first ever user becomes active manager, others pending
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_first boolean;
  v_site uuid;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'manager') INTO v_first;
  SELECT id INTO v_site FROM public.sites WHERE is_default LIMIT 1;

  INSERT INTO public.profiles (id, email, first_name, last_name, avatar_url, status, site_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'given_name', split_part(COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''), ' ', 1)),
    COALESCE(NEW.raw_user_meta_data->>'family_name', NULLIF(split_part(COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''), ' ', 2), '')),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture'),
    CASE WHEN v_first THEN 'active' ELSE 'pending' END,
    v_site
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN v_first THEN 'manager'::public.app_role ELSE 'salarie'::public.app_role END)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- CHANGE LOG
CREATE TABLE public.field_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  field text NOT NULL,
  old_value text,
  new_value text,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.field_changes TO authenticated;
GRANT SELECT, INSERT ON public.field_changes TO anon;
GRANT ALL ON public.field_changes TO service_role;
ALTER TABLE public.field_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "field_changes readable" ON public.field_changes FOR SELECT USING (true);
CREATE POLICY "field_changes insertable" ON public.field_changes FOR INSERT WITH CHECK (true);

-- EXISTING TABLES: site + authorship
ALTER TABLE public.repair_orders ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id);
ALTER TABLE public.repair_orders ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.repair_orders ADD COLUMN IF NOT EXISTS created_by_name text;

ALTER TABLE public.vehicle_inspections ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id);
ALTER TABLE public.vehicle_inspections ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.vehicle_inspections ADD COLUMN IF NOT EXISTS created_by_name text;
ALTER TABLE public.vehicle_inspections ADD COLUMN IF NOT EXISTS last_sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.vehicle_inspections ADD COLUMN IF NOT EXISTS last_sent_by_name text;

UPDATE public.repair_orders SET site_id = (SELECT id FROM public.sites WHERE is_default LIMIT 1) WHERE site_id IS NULL;
UPDATE public.vehicle_inspections SET site_id = (SELECT id FROM public.sites WHERE is_default LIMIT 1) WHERE site_id IS NULL;