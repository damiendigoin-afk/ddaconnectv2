ALTER TABLE public.service_packages
  ADD COLUMN IF NOT EXISTS source_kind text,
  ADD COLUMN IF NOT EXISTS source_file_name text,
  ADD COLUMN IF NOT EXISTS source_version text,
  ADD COLUMN IF NOT EXISTS source_page integer,
  ADD COLUMN IF NOT EXISTS price_ht numeric,
  ADD COLUMN IF NOT EXISTS price_basis text NOT NULL DEFAULT 'ttc',
  ADD COLUMN IF NOT EXISTS imported_at timestamptz,
  ADD COLUMN IF NOT EXISTS imported_by uuid,
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS service_packages_dedupe_key_idx
  ON public.service_packages (dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.service_package_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind text NOT NULL,
  file_name text NOT NULL,
  version_label text,
  lines_detected integer NOT NULL DEFAULT 0,
  lines_imported integer NOT NULL DEFAULT 0,
  lines_updated integer NOT NULL DEFAULT 0,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  imported_by uuid,
  imported_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_package_imports TO authenticated;
GRANT ALL ON public.service_package_imports TO service_role;
ALTER TABLE public.service_package_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "spi_select" ON public.service_package_imports
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "spi_insert" ON public.service_package_imports
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'manager'));
CREATE POLICY "spi_update" ON public.service_package_imports
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'manager'));
CREATE POLICY "spi_delete" ON public.service_package_imports
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'manager'));

CREATE TRIGGER trg_spi_updated BEFORE UPDATE ON public.service_package_imports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.service_package_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid REFERENCES public.service_packages(id) ON DELETE CASCADE,
  dedupe_key text,
  import_id uuid REFERENCES public.service_package_imports(id) ON DELETE SET NULL,
  previous jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid
);

GRANT SELECT, INSERT ON public.service_package_history TO authenticated;
GRANT ALL ON public.service_package_history TO service_role;
ALTER TABLE public.service_package_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sph_select" ON public.service_package_history
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "sph_insert" ON public.service_package_history
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'manager'));

CREATE INDEX IF NOT EXISTS sph_package_idx ON public.service_package_history (package_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS service_packages_source_kind_idx ON public.service_packages (source_kind);