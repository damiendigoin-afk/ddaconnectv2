-- Normalisation d'identité (accents, casse, ponctuation, ordre NOM/PRENOM)
CREATE OR REPLACE FUNCTION public.norm_person(_v text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT coalesce((
    SELECT string_agg(t, ' ' ORDER BY t)
    FROM unnest(regexp_split_to_array(upper(regexp_replace(unaccent(coalesce(_v,'')), '[^A-Za-z0-9]+', ' ', 'g')), '\s+')) AS t
    WHERE t <> ''
  ), '');
$$;

-- 1. Productifs Winmotor <-> utilisateurs DDA
CREATE TABLE public.winmotor_operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id),
  alias text NOT NULL,
  normalized text GENERATED ALWAYS AS (public.norm_person(alias)) STORED,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX winmotor_operators_site_norm_key ON public.winmotor_operators (coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid), normalized);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.winmotor_operators TO authenticated;
GRANT ALL ON public.winmotor_operators TO service_role;
ALTER TABLE public.winmotor_operators ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators readable by authenticated" ON public.winmotor_operators FOR SELECT TO authenticated USING (true);
CREATE POLICY "operators managed by managers" ON public.winmotor_operators FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'manager'));
CREATE TRIGGER trg_wm_operators_updated BEFORE UPDATE ON public.winmotor_operators
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Imports de productivité
CREATE TABLE public.productivity_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id),
  site_label text,
  period_start date NOT NULL,
  period_end date NOT NULL,
  kind text NOT NULL DEFAULT 'mensuel',
  status text NOT NULL DEFAULT 'active',
  replaced_by uuid REFERENCES public.productivity_imports(id) ON DELETE SET NULL,
  file_name text,
  storage_path text,
  totals jsonb,
  imported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  imported_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX productivity_imports_active_period ON public.productivity_imports (site_id, period_start, period_end)
  WHERE status = 'active' AND kind = 'mensuel';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.productivity_imports TO authenticated;
GRANT ALL ON public.productivity_imports TO service_role;
ALTER TABLE public.productivity_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prod imports readable by authenticated" ON public.productivity_imports FOR SELECT TO authenticated USING (true);
CREATE POLICY "prod imports managed by managers" ON public.productivity_imports FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'manager'));
CREATE TRIGGER trg_prod_imports_updated BEFORE UPDATE ON public.productivity_imports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Lignes individuelles
CREATE TABLE public.productivity_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.productivity_imports(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.sites(id),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  winmotor_name text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  hours_purchased numeric,
  hours_spent numeric,
  hours_billed numeric,
  productivity_ratio numeric,
  profitability_ratio numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX productivity_entries_user_period ON public.productivity_entries (user_id, period_start);
CREATE INDEX productivity_entries_import ON public.productivity_entries (import_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.productivity_entries TO authenticated;
GRANT ALL ON public.productivity_entries TO service_role;
ALTER TABLE public.productivity_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prod entries own or manager" ON public.productivity_entries FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'manager'));
CREATE POLICY "prod entries managed by managers" ON public.productivity_entries FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'manager'));
CREATE TRIGGER trg_prod_entries_updated BEFORE UPDATE ON public.productivity_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Initialisation avril -> juillet 2026 (SAS CASTILLON-VEYSSIERE)
DO $seed$
DECLARE
  v_site uuid;
  v_import uuid;
  v_period record;
  v_row record;
BEGIN
  SELECT id INTO v_site FROM public.sites WHERE is_default LIMIT 1;

  CREATE TEMP TABLE _seed(period_start date, period_end date, label text, nm text,
    hp numeric, hs numeric, hb numeric, pr numeric, rt numeric) ON COMMIT DROP;

  INSERT INTO _seed VALUES
  ('2026-04-01','2026-04-30','Avril 2026','GUILLOU STYVEN',93,98.70,90.06,0.97,0.91),
  ('2026-04-01','2026-04-30','Avril 2026','BENOIST ADRIEN',164,118.61,107.91,0.66,0.91),
  ('2026-04-01','2026-04-30','Avril 2026','MARCHAL ALLAN',105,58.05,41.89,0.40,0.72),
  ('2026-04-01','2026-04-30','Avril 2026','BROUSSE AURELIEN',8,32.75,25.62,3.20,0.78),
  ('2026-04-01','2026-04-30','Avril 2026','ROMAIN NICOLAS',148,109.71,112.95,0.76,1.03),
  ('2026-04-01','2026-04-30','Avril 2026','DOMINIQUE CHATAIGNER',133,102.38,80.20,0.60,0.78),
  ('2026-04-01','2026-04-30','Avril 2026','PICHARD ERWANN',119,43.50,43.43,0.36,1.00),
  ('2026-04-01','2026-04-30','Avril 2026','CORDONNIER JULIEN',112,97.00,125.84,1.12,1.30),
  ('2026-04-01','2026-04-30','Avril 2026','DANGREMONT QUENTIN',NULL,11.50,7.68,NULL,0.67),
  ('2026-04-01','2026-04-30','Avril 2026','PAOLOZZI HUGO',126,76.15,54.48,0.43,0.72),
  ('2026-05-01','2026-05-31','Mai 2026','GUILLOU STYVEN',93,47.00,45.67,0.49,0.97),
  ('2026-05-01','2026-05-31','Mai 2026','BENOIST ADRIEN',125,87.02,78.29,0.63,0.90),
  ('2026-05-01','2026-05-31','Mai 2026','MARCHAL ALLAN',91,43.45,30.62,0.34,0.70),
  ('2026-05-01','2026-05-31','Mai 2026','BROUSSE AURELIEN',NULL,7.00,5.42,NULL,0.77),
  ('2026-05-01','2026-05-31','Mai 2026','ROMAIN NICOLAS',93,59.87,64.18,0.69,1.07),
  ('2026-05-01','2026-05-31','Mai 2026','DOMINIQUE CHATAIGNER',140,44.42,43.14,0.31,0.97),
  ('2026-05-01','2026-05-31','Mai 2026','PICHARD ERWANN',77,33.67,37.27,0.48,1.11),
  ('2026-05-01','2026-05-31','Mai 2026','CORDONNIER JULIEN',119,97.04,131.33,1.10,1.35),
  ('2026-05-01','2026-05-31','Mai 2026','PAOLOZZI HUGO',56,11.25,10.05,0.18,0.89),
  ('2026-06-01','2026-06-30','Juin 2026','GUILLOU STYVEN',161,98.13,99.31,0.62,1.03),
  ('2026-06-01','2026-06-30','Juin 2026','BENOIST ADRIEN',88,99.22,92.84,1.06,0.93),
  ('2026-06-01','2026-06-30','Juin 2026','MARCHAL ALLAN',105,81.85,66.64,0.63,0.81),
  ('2026-06-01','2026-06-30','Juin 2026','ROMAIN NICOLAS',157,123.15,128.32,0.82,1.04),
  ('2026-06-01','2026-06-30','Juin 2026','DOMINIQUE CHATAIGNER',165,199.85,211.36,1.28,1.06),
  ('2026-06-01','2026-06-30','Juin 2026','PICHARD ERWANN',118,43.40,44.34,0.38,1.02),
  ('2026-06-01','2026-06-30','Juin 2026','CORDONNIER JULIEN',147,162.21,188.80,1.27,1.16),
  ('2026-06-01','2026-06-30','Juin 2026','PAOLOZZI HUGO',105,42.00,33.37,0.32,0.79),
  ('2026-07-01','2026-07-31','Juillet 2026','AKRIB KYLIAN',NULL,76.50,94.47,NULL,1.23),
  ('2026-07-01','2026-07-31','Juillet 2026','GUILLOU STYVEN',147,65.90,71.92,0.49,1.09),
  ('2026-07-01','2026-07-31','Juillet 2026','BENOIST ADRIEN',163,95.60,89.61,0.55,0.94),
  ('2026-07-01','2026-07-31','Juillet 2026','MARCHAL ALLAN',78,23.67,18.78,0.24,0.79),
  ('2026-07-01','2026-07-31','Juillet 2026','ROMAIN NICOLAS',123,78.73,82.45,0.67,1.05),
  ('2026-07-01','2026-07-31','Juillet 2026','DOMINIQUE CHATAIGNER',171,129.15,131.20,0.77,1.02),
  ('2026-07-01','2026-07-31','Juillet 2026','PICHARD ERWANN',133,58.05,55.04,0.41,0.95),
  ('2026-07-01','2026-07-31','Juillet 2026','CORDONNIER JULIEN',112,112.50,131.24,1.17,1.17),
  ('2026-07-01','2026-07-31','Juillet 2026','PAOLOZZI HUGO',154,41.45,42.48,0.28,1.02);

  -- productifs + rapprochement automatique avec les profils DDA
  INSERT INTO public.winmotor_operators (site_id, alias, user_id)
  SELECT v_site, s.nm,
    (SELECT p.id FROM public.profiles p
      WHERE public.norm_person(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')) = public.norm_person(s.nm)
      LIMIT 1)
  FROM (SELECT DISTINCT nm FROM _seed) s;

  FOR v_period IN SELECT DISTINCT period_start, period_end, label FROM _seed ORDER BY period_start LOOP
    INSERT INTO public.productivity_imports (site_id, site_label, period_start, period_end, kind, status, file_name, totals)
    VALUES (v_site, 'SAS CASTILLON-VEYSSIERE', v_period.period_start, v_period.period_end, 'mensuel', 'active',
      'Initialisation ' || v_period.label,
      (SELECT jsonb_build_object(
          'hours_purchased', sum(hp), 'hours_spent', sum(hs), 'hours_billed', sum(hb))
         FROM _seed WHERE period_start = v_period.period_start))
    RETURNING id INTO v_import;

    FOR v_row IN SELECT * FROM _seed WHERE period_start = v_period.period_start LOOP
      INSERT INTO public.productivity_entries
        (import_id, site_id, user_id, winmotor_name, period_start, period_end,
         hours_purchased, hours_spent, hours_billed, productivity_ratio, profitability_ratio)
      VALUES (v_import, v_site,
        (SELECT o.user_id FROM public.winmotor_operators o WHERE o.normalized = public.norm_person(v_row.nm) LIMIT 1),
        v_row.nm, v_row.period_start, v_row.period_end,
        v_row.hp, v_row.hs, v_row.hb, v_row.pr, v_row.rt);
    END LOOP;
  END LOOP;
END
$seed$;