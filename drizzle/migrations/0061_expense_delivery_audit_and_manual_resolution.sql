CREATE OR REPLACE FUNCTION public.audit_expense_delivery() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
INSERT INTO public.expense_revision_events(expense_id,revision,action,actor_id,detail) VALUES(NEW.expense_id,NEW.revision,'delivery_'||NEW.state,auth.uid(),jsonb_build_object('delivery',NEW.id,'recipient',NEW.recipient,'kind',NEW.kind,'target_revision',NEW.target_revision,'provider_id',NEW.provider_id,'sent_at',NEW.sent_at,'error',NEW.error));
RETURN NEW;
END $$;
CREATE TRIGGER expense_delivery_audit AFTER INSERT OR UPDATE OF state ON public.expense_revision_deliveries FOR EACH ROW EXECUTE FUNCTION public.audit_expense_delivery();
CREATE OR REPLACE FUNCTION public.resolve_expense_uncertain_delivery(_delivery uuid,_sent boolean,_proof text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE d public.expense_revision_deliveries; e public.expense_notes; BEGIN
SELECT * INTO d FROM public.expense_revision_deliveries WHERE id=_delivery FOR UPDATE;
SELECT * INTO e FROM public.expense_notes WHERE id=d.expense_id;
IF NOT public.can_manage_expense(auth.uid(),e.site_id,'account') OR d.state NOT IN ('sending','unknown') OR length(trim(coalesce(_proof,'')))<10 THEN RAISE EXCEPTION 'Contrôle et preuve comptable requis'; END IF;
IF d.state='sending' AND d.created_at>now()-interval '15 minutes' THEN RAISE EXCEPTION 'Envoi récent : attendez avant rapprochement manuel'; END IF;
UPDATE public.expense_revision_deliveries SET state=CASE WHEN _sent THEN 'sent' ELSE 'failed' END,sent_at=CASE WHEN _sent THEN now() ELSE NULL END,error=CASE WHEN _sent THEN NULL ELSE 'Absence d’envoi vérifiée manuellement' END WHERE id=_delivery;
INSERT INTO public.expense_revision_events(expense_id,revision,action,actor_id,detail) VALUES(d.expense_id,d.revision,'delivery_manual_resolution',auth.uid(),jsonb_build_object('delivery',_delivery,'sent',_sent,'proof',_proof));
END $$;
REVOKE ALL ON FUNCTION public.resolve_expense_uncertain_delivery(uuid,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_expense_uncertain_delivery(uuid,boolean,text) TO authenticated;