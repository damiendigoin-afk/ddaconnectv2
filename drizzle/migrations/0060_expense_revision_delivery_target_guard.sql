CREATE OR REPLACE FUNCTION public.guard_expense_delivery_target() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ DECLARE e public.expense_notes; code text; label text; target text; BEGIN
SELECT * INTO e FROM public.expense_notes WHERE id=NEW.expense_id;
SELECT s.code,s.name INTO code,label FROM public.sites s WHERE s.id=e.site_id;
IF lower(coalesce(code,'')||' '||coalesce(label,'')) ~ '(castillon|cyprien)' THEN target='compta@garagecastillon.fr'; ELSIF lower(coalesce(code,'')||' '||coalesce(label,'')) ~ '(lalinde|digoin|dda)' THEN target='compta@dda-lalinde.fr'; END IF;
IF NEW.revision<>e.revision OR NEW.kind NOT IN ('initial','replace','cancel') THEN RAISE EXCEPTION 'Envoi invalide'; END IF;
IF NEW.kind IN ('initial','replace') AND (NEW.recipient IS DISTINCT FROM target OR e.cancelled_at IS NOT NULL) THEN RAISE EXCEPTION 'Destinataire comptable invalide'; END IF;
IF NEW.kind IN ('cancel','replace') AND NOT EXISTS(SELECT 1 FROM public.expense_versions v WHERE v.expense_id=e.id AND v.revision=NEW.target_revision AND v.snapshot->>'accounting_email'=NEW.recipient AND v.snapshot->>'sent_at' IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM public.expense_revision_deliveries d WHERE d.expense_id=e.id AND d.revision=NEW.target_revision AND d.recipient=NEW.recipient AND d.state='sent') THEN RAISE EXCEPTION 'Ancien envoi non prouvé'; END IF;
RETURN NEW;
END $$;
CREATE TRIGGER expense_delivery_target_guard BEFORE INSERT ON public.expense_revision_deliveries FOR EACH ROW EXECUTE FUNCTION public.guard_expense_delivery_target();