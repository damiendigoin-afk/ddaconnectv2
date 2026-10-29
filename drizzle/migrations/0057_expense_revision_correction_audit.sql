ALTER TABLE public.expense_notes ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1, ADD COLUMN IF NOT EXISTS cancelled_at timestamptz, ADD COLUMN IF NOT EXISTS correction_reason text, ADD COLUMN IF NOT EXISTS accounting_instruction text, ADD COLUMN IF NOT EXISTS exported_at timestamptz;
CREATE TABLE public.expense_versions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), expense_id uuid NOT NULL REFERENCES public.expense_notes(id), revision integer NOT NULL, snapshot jsonb NOT NULL, reason text NOT NULL, actor_id uuid NOT NULL, actor_name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(expense_id,revision));
GRANT SELECT ON public.expense_versions TO authenticated;
GRANT ALL ON public.expense_versions TO service_role;
ALTER TABLE public.expense_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY expense_versions_read ON public.expense_versions FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.expense_notes e WHERE e.id=expense_id AND (e.user_id=auth.uid() OR public.can_manage_expense(auth.uid(),e.site_id,'read'))));
CREATE TABLE public.expense_revision_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), expense_id uuid NOT NULL REFERENCES public.expense_notes(id), revision integer NOT NULL, action text NOT NULL, actor_id uuid, actor_name text, detail jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.expense_revision_events TO authenticated;
GRANT ALL ON public.expense_revision_events TO service_role;
ALTER TABLE public.expense_revision_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY expense_revision_events_read ON public.expense_revision_events FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.expense_notes e WHERE e.id=expense_id AND (e.user_id=auth.uid() OR public.can_manage_expense(auth.uid(),e.site_id,'read'))));
CREATE TABLE public.expense_revision_deliveries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), expense_id uuid NOT NULL REFERENCES public.expense_notes(id), revision integer NOT NULL, target_revision integer, recipient text NOT NULL, kind text NOT NULL, state text NOT NULL DEFAULT 'ready', pdf_path text NOT NULL, provider_id text, error text, sent_at timestamptz, processed_at timestamptz, processed_by uuid, processing_reference text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(expense_id,revision,recipient,kind));
GRANT SELECT ON public.expense_revision_deliveries TO authenticated;
GRANT ALL ON public.expense_revision_deliveries TO service_role;
ALTER TABLE public.expense_revision_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY expense_revision_deliveries_read ON public.expense_revision_deliveries FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.expense_notes e WHERE e.id=expense_id AND (e.user_id=auth.uid() OR public.can_manage_expense(auth.uid(),e.site_id,'read'))));
CREATE OR REPLACE FUNCTION public.expense_immutable_history() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN RAISE EXCEPTION 'Historique immuable'; END $$;
CREATE TRIGGER expense_versions_immutable BEFORE UPDATE OR DELETE ON public.expense_versions FOR EACH ROW EXECUTE FUNCTION public.expense_immutable_history();
CREATE TRIGGER expense_events_immutable BEFORE UPDATE OR DELETE ON public.expense_revision_events FOR EACH ROW EXECUTE FUNCTION public.expense_immutable_history();
CREATE OR REPLACE FUNCTION public.correct_expense(_id uuid,_revision integer,_action text,_patch jsonb,_reason text,_instruction text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e public.expense_notes; n public.expense_notes; actor text; old jsonb; changed boolean; dest uuid;
BEGIN
SELECT * INTO e FROM public.expense_notes WHERE id=_id FOR UPDATE;
IF NOT FOUND OR NOT public.is_active_user(auth.uid()) THEN RAISE EXCEPTION 'Note inaccessible'; END IF;
IF e.revision<>_revision THEN RAISE EXCEPTION 'Note modifiée par un autre utilisateur : actualisez'; END IF;
IF e.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'Note annulée'; END IF;
IF NOT public.can_manage_expense(auth.uid(),e.site_id,'edit') AND NOT (e.user_id=auth.uid() AND e.status IN ('brouillon','soumis','refuse')) THEN RAISE EXCEPTION 'Correction non autorisée'; END IF;
IF length(trim(coalesce(_reason,'')))<3 THEN RAISE EXCEPTION 'Motif obligatoire'; END IF;
IF _action NOT IN ('edit','cancel') THEN RAISE EXCEPTION 'Action invalide'; END IF;
IF EXISTS(SELECT 1 FROM public.expense_revision_deliveries WHERE expense_id=_id AND state IN ('sending','unknown')) THEN RAISE EXCEPTION 'Envoi en cours ou incertain : contrôle comptable requis'; END IF;
IF (e.accounted_at IS NOT NULL OR e.reconciled_at IS NOT NULL OR e.settled_at IS NOT NULL OR e.exported_at IS NOT NULL) AND length(trim(coalesce(_instruction,'')))<3 THEN RAISE EXCEPTION 'Traitement comptable approprié obligatoire (extourne / régularisation)'; END IF;
SELECT coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),email,'Utilisateur') INTO actor FROM public.profiles WHERE id=auth.uid();
old=to_jsonb(e);
INSERT INTO public.expense_versions(expense_id,revision,snapshot,reason,actor_id,actor_name) VALUES (_id,e.revision,old,'Version avant correction',auth.uid(),coalesce(actor,'Utilisateur')) ON CONFLICT(expense_id,revision) DO NOTHING;
IF _action='edit' THEN
IF EXISTS(SELECT 1 FROM jsonb_object_keys(_patch) k WHERE k NOT IN ('site_id','merchant','spent_on','category','purpose','payment_method','amount_ttc','vat_amount','vat_rate','notes','receipt_path','receipt_mime','account_ref','account_other')) THEN RAISE EXCEPTION 'Champ non modifiable'; END IF;
n=jsonb_populate_record(e,_patch); dest=n.site_id;
IF dest IS NULL OR NOT public.user_can_access_site(auth.uid(),dest) THEN RAISE EXCEPTION 'Établissement cible non autorisé'; END IF;
IF n.amount_ttc<=0 OR n.amount_ttc='NaN'::numeric OR n.amount_ttc='Infinity'::numeric OR (n.vat_amount IS NOT NULL AND (n.vat_amount<0 OR n.vat_amount>n.amount_ttc OR n.vat_amount='NaN'::numeric)) THEN RAISE EXCEPTION 'Montants invalides'; END IF;
IF n.payment_method NOT IN ('perso','pro_cb','pro_especes','pro_cheque','pro_virement','en_compte') THEN RAISE EXCEPTION 'Règlement invalide'; END IF;
IF n.payment_method='en_compte' AND (coalesce(n.account_ref,'')='' OR (n.account_ref='autre' AND trim(coalesce(n.account_other,''))='')) THEN RAISE EXCEPTION 'Compte utilisé obligatoire'; END IF;
IF n.receipt_path IS DISTINCT FROM e.receipt_path AND n.receipt_path IS NOT NULL AND n.receipt_path NOT LIKE 'notes-frais/'||auth.uid()::text||'/%' THEN RAISE EXCEPTION 'Justificatif non autorisé'; END IF;
changed=EXISTS(SELECT 1 FROM jsonb_each(_patch) p WHERE p.value IS DISTINCT FROM old->p.key);
IF NOT changed THEN RAISE EXCEPTION 'Aucune modification'; END IF;
UPDATE public.expense_notes SET site_id=n.site_id,merchant=n.merchant,spent_on=n.spent_on,category=n.category,purpose=n.purpose,payment_method=n.payment_method,amount_ttc=n.amount_ttc,vat_amount=n.vat_amount,vat_rate=n.vat_rate,notes=n.notes,receipt_path=n.receipt_path,receipt_mime=n.receipt_mime,account_ref=n.account_ref,account_other=n.account_other,revision=e.revision+1,status='soumis',validated_at=NULL,validated_by=NULL,validated_by_name=NULL,validated_pdf_path=NULL,send_status=NULL,send_error=NULL,sent_at=NULL,accounting_email=NULL,correction_reason=trim(_reason),accounting_instruction=nullif(trim(_instruction),''),submitted_at=now(),archived_at=NULL WHERE id=_id RETURNING * INTO n;
ELSE
UPDATE public.expense_notes SET revision=e.revision+1,status='annulee',cancelled_at=now(),correction_reason=trim(_reason),accounting_instruction=nullif(trim(_instruction),''),validated_pdf_path=NULL,send_status=NULL,send_error=NULL WHERE id=_id RETURNING * INTO n;
END IF;
INSERT INTO public.expense_versions(expense_id,revision,snapshot,reason,actor_id,actor_name) VALUES(_id,n.revision,to_jsonb(n),trim(_reason),auth.uid(),coalesce(actor,'Utilisateur'));
INSERT INTO public.expense_revision_events(expense_id,revision,action,actor_id,actor_name,detail) VALUES(_id,n.revision,_action,auth.uid(),actor,jsonb_build_object('before',old,'after',to_jsonb(n),'reason',_reason,'accounting_instruction',_instruction));
RETURN to_jsonb(n);
END $$;
REVOKE ALL ON FUNCTION public.correct_expense(uuid,integer,text,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_expense(uuid,integer,text,jsonb,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.prepare_expense_revision(_id uuid,_revision integer,_pdf text,_jobs jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e public.expense_notes; actor text; j jsonb;
BEGIN
SELECT * INTO e FROM public.expense_notes WHERE id=_id FOR UPDATE;
IF NOT FOUND OR NOT public.can_manage_expense(auth.uid(),e.site_id,'validate') THEN RAISE EXCEPTION 'Validation non autorisée'; END IF;
IF e.revision<>_revision THEN RAISE EXCEPTION 'Version obsolète'; END IF;
IF e.status NOT IN ('soumis','valide','annulee') THEN RAISE EXCEPTION 'État non validable'; END IF;
IF _pdf NOT LIKE 'notes-frais/'||_id::text||'/v'||_revision::text||'/%' THEN RAISE EXCEPTION 'Document invalide'; END IF;
SELECT coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),email,'Utilisateur') INTO actor FROM public.profiles WHERE id=auth.uid();
IF e.status='soumis' THEN
UPDATE public.expense_notes SET status='valide',validated_at=now(),validated_by=auth.uid(),validated_by_name=actor,validated_pdf_path=_pdf,reject_reason=NULL WHERE id=_id;
INSERT INTO public.expense_revision_events(expense_id,revision,action,actor_id,actor_name,detail) VALUES(_id,_revision,'validate',auth.uid(),actor,jsonb_build_object('pdf_path',_pdf));
END IF;
FOR j IN SELECT * FROM jsonb_array_elements(_jobs) LOOP
INSERT INTO public.expense_revision_deliveries(expense_id,revision,target_revision,recipient,kind,pdf_path) VALUES(_id,_revision,(j->>'target_revision')::integer,j->>'recipient',j->>'kind',_pdf) ON CONFLICT(expense_id,revision,recipient,kind) DO NOTHING;
END LOOP;
UPDATE public.expense_notes SET validated_pdf_path=coalesce(validated_pdf_path,_pdf) WHERE id=_id;
END $$;
REVOKE ALL ON FUNCTION public.prepare_expense_revision(uuid,integer,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_expense_revision(uuid,integer,text,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.claim_expense_revision_delivery(_delivery uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE d public.expense_revision_deliveries; e public.expense_notes; BEGIN
SELECT * INTO d FROM public.expense_revision_deliveries WHERE id=_delivery FOR UPDATE;
SELECT * INTO e FROM public.expense_notes WHERE id=d.expense_id FOR UPDATE;
IF e.revision<>d.revision OR e.status NOT IN ('valide','annulee') OR NOT public.can_manage_expense(auth.uid(),e.site_id,'send') THEN RAISE EXCEPTION 'Envoi non autorisé'; END IF;
IF d.state NOT IN ('ready','failed') THEN RETURN false; END IF;
UPDATE public.expense_revision_deliveries SET state='sending',error=NULL WHERE id=_delivery;
RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.claim_expense_revision_delivery(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_expense_revision_delivery(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.ack_expense_revision_delivery(_delivery uuid,_reference text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE d public.expense_revision_deliveries; e public.expense_notes; BEGIN
SELECT * INTO d FROM public.expense_revision_deliveries WHERE id=_delivery FOR UPDATE;
SELECT * INTO e FROM public.expense_notes WHERE id=d.expense_id;
IF NOT public.can_manage_expense(auth.uid(),e.site_id,'account') OR d.state<>'sent' OR length(trim(coalesce(_reference,'')))<3 THEN RAISE EXCEPTION 'Référence de traitement comptable et envoi confirmé requis'; END IF;
IF d.processed_at IS NOT NULL THEN RETURN; END IF;
UPDATE public.expense_revision_deliveries SET processed_at=now(),processed_by=auth.uid(),processing_reference=trim(_reference) WHERE id=_delivery;
INSERT INTO public.expense_revision_events(expense_id,revision,action,actor_id,detail) VALUES(d.expense_id,d.revision,'accounting_processed',auth.uid(),jsonb_build_object('delivery',_delivery,'reference',_reference));
END $$;
REVOKE ALL ON FUNCTION public.ack_expense_revision_delivery(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ack_expense_revision_delivery(uuid,text) TO authenticated;
COMMENT ON TABLE public.expense_revision_deliveries IS 'Expense accounting evidence ledger, not a generic email queue; sent is distinct from explicit accounting acknowledgement.';