INSERT INTO public.automation_jobs (job_key, label, description, schedule, enabled)
SELECT 'crm_escalation', 'Escalade des demandes CRM', 'Relance le responsable, puis les collègues, puis le manager sur les demandes clients hors délai.', 'toutes les heures', true
WHERE NOT EXISTS (SELECT 1 FROM public.automation_jobs WHERE job_key = 'crm_escalation');