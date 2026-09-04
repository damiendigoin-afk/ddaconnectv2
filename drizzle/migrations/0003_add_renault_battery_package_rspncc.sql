-- Forfait Renault Public zone C au 01/07/2026 : remplacement batterie Captur I / QM3
INSERT INTO public.service_packages (
  brand, segment, model, energies, operation_code, label, hours, parts_ht, price_ttc,
  year_from, year_to, notes, active, source_kind, source_version, price_basis, dedupe_key
)
SELECT
  'Renault', 'B', 'CAPTUR I / QM3', ARRAY['essence','diesel','inconnu'], 'RSPNCC',
  'REMPLACEMENT BATTERIE 70 AH 720 A (BATTERIE ET MAIN D''OEUVRE COMPRISES)',
  NULL, NULL, 389,
  2013, 2019,
  'Mémento Renault Public zone C au 01/07/2026 — Captur I / QM3, motorisations 1.2 16V, 1.3 16V, 1.5 dCi, 1.6 16V. Batterie 70 Ah 720 A et main-d''oeuvre comprises.',
  true, 'memento_public', '2026-07-01', 'ttc', 'renault:RSPNCC:captur1:2026-07-01'
WHERE NOT EXISTS (
  SELECT 1 FROM public.service_packages WHERE operation_code = 'RSPNCC'
);

-- Orthographe des lignes de devis déjà enregistrées
UPDATE public.pricing_quote_lines
SET label = replace(label, 'pneux', 'pneus')
WHERE label LIKE '%pneux%';