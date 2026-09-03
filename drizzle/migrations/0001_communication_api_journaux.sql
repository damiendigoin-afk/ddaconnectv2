-- 1) Bibliothèque de supports publicitaires (module Communication)
CREATE TABLE public.ad_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  brand text NOT NULL DEFAULT 'autre',
  storage_path text NOT NULL,
  file_name text,
  mime_type text,
  starts_on date,
  ends_on date,
  active boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  shown_count integer NOT NULL DEFAULT 0,
  last_shown_at timestamptz,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_assets TO authenticated;
GRANT ALL ON public.ad_assets TO service_role;
ALTER TABLE public.ad_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ad_assets_read" ON public.ad_assets FOR SELECT TO authenticated USING (true);
CREATE POLICY "ad_assets_insert" ON public.ad_assets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "ad_assets_update" ON public.ad_assets FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "ad_assets_delete" ON public.ad_assets FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'manager'));
CREATE TRIGGER ad_assets_updated_at BEFORE UPDATE ON public.ad_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Paramètres API par service (aucune clé en clair : seulement le nom du secret + indice)
CREATE TABLE public.api_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL UNIQUE,
  label text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  endpoint text,
  secret_name text,
  key_hint text,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_message text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_settings TO authenticated;
GRANT ALL ON public.api_settings TO service_role;
ALTER TABLE public.api_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "api_settings_read" ON public.api_settings FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'manager'));
CREATE POLICY "api_settings_write" ON public.api_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'manager'));
CREATE TRIGGER api_settings_updated_at BEFORE UPDATE ON public.api_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.api_settings (service, label, secret_name) VALUES
  ('ocr', 'OCR / lecture de documents', 'LOVABLE_API_KEY'),
  ('email', 'Envoi d''emails', 'RESEND_API_KEY'),
  ('stockage', 'Stockage de fichiers', NULL),
  ('geocodage', 'Géocodage et temps de trajet', NULL);

-- 3) Référentiel des journaux comptables Winmotor (base future recouvrement / compta)
CREATE TABLE public.winmotor_journals (
  code text PRIMARY KEY,
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.winmotor_journals TO authenticated;
GRANT ALL ON public.winmotor_journals TO service_role;
ALTER TABLE public.winmotor_journals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "winmotor_journals_read" ON public.winmotor_journals FOR SELECT TO authenticated USING (true);

INSERT INTO public.winmotor_journals (code, label) VALUES
  ('001','Atelier'),('002','Magasin'),('003','Cession VN'),('004','Garantie'),('005','Vente VO'),
  ('006','VN'),('007','Assurance'),('008','Commissions'),('009','Minute'),('010','Cession préparation VO'),
  ('011','Cession garantie VO'),('012','Cession cadeaux'),('013','Cession malfaçon'),('014','Cession travaux internes'),
  ('015','Cession formation / réunion / déplacement'),('016','Fleetbox'),('051','Crédit Agricole'),
  ('052','Encaissements cartes bleues'),('053','Caisse'),('054','Remise chèques'),('060','Achats'),
  ('061','Achat VO'),('070','Portefeuille chèques'),('080','OD'),('081','RAN'),
  ('082','Différences de règlement'),('083','Acomptes déduits'),('084','Simulation'),
  ('085','Reprises VO particuliers'),('099','Report à nouveau');

-- 4) Emplacement modèle de lettre de relance (module recouvrement à venir)
INSERT INTO public.message_templates (key, label, subject, body, active)
SELECT 'relance_recouvrement', 'Lettre de relance (recouvrement)',
  'Relance — facture {{numero_facture}}',
  E'Madame, Monsieur,\n\nSauf erreur de notre part, la facture {{numero_facture}} du {{date_facture}} d''un montant de {{montant}} € reste impayée.\n\nNous vous remercions de bien vouloir procéder à son règlement.\n\nCordialement,\n{{site}}',
  false
WHERE NOT EXISTS (SELECT 1 FROM public.message_templates WHERE key = 'relance_recouvrement');