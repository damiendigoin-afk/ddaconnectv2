GRANT EXECUTE ON FUNCTION public.prepare_expense_revision(uuid,integer,text,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.guard_expense_revision_write() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
IF OLD.revision>1 AND auth.role()<>'service_role' AND current_user IN ('authenticated','anon') THEN RAISE EXCEPTION 'Utilisez le circuit de correction versionné'; END IF;
IF OLD.cancelled_at IS NOT NULL AND NEW.status<>'annulee' THEN RAISE EXCEPTION 'Note annulée'; END IF;
RETURN NEW;
END $$;
CREATE TRIGGER expense_revision_write_guard BEFORE UPDATE ON public.expense_notes FOR EACH ROW EXECUTE FUNCTION public.guard_expense_revision_write();