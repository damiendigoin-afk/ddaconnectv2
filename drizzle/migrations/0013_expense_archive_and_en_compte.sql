ALTER TABLE public.expense_notes
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID,
  ADD COLUMN IF NOT EXISTS archived_by_name TEXT,
  ADD COLUMN IF NOT EXISTS account_ref TEXT,
  ADD COLUMN IF NOT EXISTS account_other TEXT,
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciled_by_name TEXT;

CREATE INDEX IF NOT EXISTS expense_notes_archived_idx ON public.expense_notes (archived_at);

DROP POLICY IF EXISTS exp_delete ON public.expense_notes;
CREATE POLICY exp_delete ON public.expense_notes
FOR DELETE TO authenticated
USING (
  status = ANY (ARRAY['brouillon'::text, 'soumis'::text, 'refuse'::text])
  AND (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  )
);