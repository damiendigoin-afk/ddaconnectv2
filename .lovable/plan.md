# Audit IA du 27/09 — résultat (lecture seule, aucune modification)

Aucun code modifié, aucune publication, aucun appel IA déclenché. Sources : journal d'usage IA de DDA, cache IA (réponses enregistrées), photos, points et kilométrages du tour CW-862-AY, journal de la passerelle IA.

## Les 3 appels `vision` (17:13:50, 17:14:47, 17:16:06) — confiance élevée

- Écran : **Atelier > Scanner une plaque** (fonction `ocrPlate`, seule à utiliser ce libellé sur cet écran).
- Preuve : les 3 réponses en cache sont identiques, `{"plate":"CW-862-AY","confidence":0.95}`. Ce sont 3 photos différentes (empreintes distinctes, 0 réutilisation du cache), donc 3 prises de plaque successives.
- Suite de l'enchaînement : dossier DDA-2026-00129 créé à 17:16:54 avec le kilométrage 189 444, puis le tour créé à 17:17:06. Les 3 lectures ont donc eu lieu avant le tour, pendant l'ouverture du dossier.
- Limite : le journal n'enregistre ni l'utilisateur ni la raison des 2 reprises. Le résultat était le même les 3 fois, et le cache n'a pas servi parce que les photos différaient.

## Les 2 appels `tire_wheel` — confirmés

- 17:18:22 : pneu avant gauche, 3 photos prises à 17:18:00–02. Lecture : 155/65R14 75T, 3 mm.
- 17:21:29 : pneu arrière gauche, 3 photos prises à 17:21:06–08. Lecture : Cooper 155/65R14.

## `supplier_invoice` 16:14:46 — confirmé

- Écran : Pièces & achats, lecture d'un document fournisseur.
- Document : bon de livraison FAURIE AUTO SARLAT n° 914730 du 25/09, commande 45841139, OR 50878.
- 16:26:15 et 16:26:41 : réponses reprises du cache, 0 crédit.

## Totaux

- Total des lignes fournies : 0,17 + 0,19 + 0,04 + 0,03 + 0,03 + 0,16 = **0,62 crédit**, estimé par DDA.
- Coût facturé par la passerelle IA pour ces 6 mêmes appels : **0,183 crédit** (0,0188 + 0,0203 + 0,0193 + 0,0154 + 0,0154 + 0,0933).
- Mon audit précédent (environ 0,41 crédit pour les 9 appels du jour) reprenait le coût facturé, pas l'estimation de DDA. Il ne sous-estimait donc pas ce qui est facturé. L'estimation affichée dans DDA est environ 3 fois plus élevée que le coût réel.

## Suite possible (non incluse, à demander)

- Enregistrer l'utilisateur et l'écran dans le journal d'usage IA.
- Aligner l'estimation de DDA sur le coût réel facturé.
