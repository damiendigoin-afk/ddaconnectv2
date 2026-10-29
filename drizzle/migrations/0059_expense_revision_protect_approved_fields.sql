CREATE OR REPLACE FUNCTION public.guard_expense_revision_write() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
IF auth.role()<>'service_role' AND current_user IN ('authenticated','anon') AND (OLD.revision>1 OR OLD.status IN ('valide','transmise','reglee','comptabilisee','annulee')) THEN RAISE EXCEPTION 'Utilisez le circuit de correction versionné'; END IF;
IF OLD.cancelled_at IS NOT NULL AND NEW.status<>'annulee' THEN RAISE EXCEPTION 'Note annulée'; END IF;
RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.guard_expense_history_delete() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN IF OLD.revision>1 OR EXISTS(SELECT 1 FROM public.expense_versions WHERE expense_id=OLD.id) THEN RAISE EXCEPTION 'Note versionnée : annulation uniquement'; END IF; RETURN OLD; END $$;
CREATE TRIGGER expense_history_delete_guard BEFORE DELETE ON public.expense_notes FOR EACH ROW EXECUTE FUNCTION public.guard_expense_history_delete();