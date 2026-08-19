CREATE TABLE public.message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.message_templates TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.message_templates TO authenticated;
GRANT ALL ON public.message_templates TO service_role;

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "templates_select_authenticated" ON public.message_templates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "templates_insert_manager" ON public.message_templates
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'manager'));
CREATE POLICY "templates_update_manager" ON public.message_templates
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'manager'));
CREATE POLICY "templates_delete_manager" ON public.message_templates
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'manager'));

CREATE TRIGGER update_message_templates_updated_at
  BEFORE UPDATE ON public.message_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.message_templates (key, label, subject, body) VALUES
('expert_passage', 'Passage terrain demandé', 'Demande de passage terrain — {{plate}}',
 'Bonjour,

Nous vous sollicitons pour un passage terrain sur le véhicule {{plate}} {{vehicle}} (OR {{or}}, sinistre {{claim}}).

Le véhicule est disponible dans nos ateliers.

Cordialement,'),
('expert_complementaires', 'Travaux complémentaires', 'Travaux complémentaires — {{plate}}',
 'Bonjour,

Lors du démontage du véhicule {{plate}} {{vehicle}} (OR {{or}}, sinistre {{claim}}), nous avons découvert des travaux complémentaires non prévus au rapport initial.

Vous trouverez les éléments photographiques en pièce jointe.

Cordialement,'),
('expert_autre', 'Autre', 'Dossier {{plate}} — information',
 'Bonjour,

Concernant le véhicule {{plate}} {{vehicle}} (OR {{or}}, sinistre {{claim}}) :

Cordialement,');