-- Documents à classer (file d'attente OCR sans dossier trouvé)
CREATE TABLE IF NOT EXISTS public.inbox_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  file_size integer,
  doc_type text,
  confidence numeric,
  extracted jsonb NOT NULL DEFAULT '{}'::jsonb,
  plate text,
  customer_name text,
  status text NOT NULL DEFAULT 'a_classer',
  linked_kind text,
  linked_id uuid,
  note text,
  created_by uuid,
  created_by_name text,
  classified_by uuid,
  classified_by_name text,
  classified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inbox_documents TO authenticated;
GRANT ALL ON public.inbox_documents TO service_role;
ALTER TABLE public.inbox_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inbox_documents_select" ON public.inbox_documents
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "inbox_documents_insert" ON public.inbox_documents
  FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "inbox_documents_update" ON public.inbox_documents
  FOR UPDATE TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "inbox_documents_delete" ON public.inbox_documents
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'manager'));

CREATE INDEX IF NOT EXISTS inbox_documents_status_idx ON public.inbox_documents(status, created_at DESC);

-- Journal des fusions clients / véhicules
CREATE TABLE IF NOT EXISTS public.merge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_kind text NOT NULL,
  kept_id uuid NOT NULL,
  merged_id uuid NOT NULL,
  reason text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  actor_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.merge_log TO authenticated;
GRANT ALL ON public.merge_log TO service_role;
ALTER TABLE public.merge_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "merge_log_select" ON public.merge_log
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "merge_log_insert" ON public.merge_log
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'manager'));

CREATE INDEX IF NOT EXISTS merge_log_created_idx ON public.merge_log(created_at DESC);