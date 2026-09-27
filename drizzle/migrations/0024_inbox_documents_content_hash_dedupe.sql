ALTER TABLE public.inbox_documents ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE public.inbox_documents ADD COLUMN IF NOT EXISTS duplicate_of uuid;
CREATE INDEX IF NOT EXISTS inbox_documents_hash_idx ON public.inbox_documents(site_id, content_hash) WHERE content_hash IS NOT NULL;

WITH ranked AS (
  SELECT id, first_value(id) OVER w AS keep_id, row_number() OVER w AS rn
  FROM public.inbox_documents
  WHERE status IS DISTINCT FROM 'doublon'
  WINDOW w AS (
    PARTITION BY site_id, doc_type, file_name, file_size, extracted::text
    ORDER BY (linked_id IS NOT NULL) DESC, (status NOT IN ('non_traite','a_verifier')) DESC, created_at DESC
  )
)
UPDATE public.inbox_documents d
SET status = 'doublon', duplicate_of = r.keep_id
FROM ranked r
WHERE d.id = r.id AND r.rn > 1 AND d.status IN ('non_traite','a_verifier');