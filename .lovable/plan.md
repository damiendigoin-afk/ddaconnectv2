# Diagnostic — duplicata facture FAURIE AXESS PREMIUM BRIVE (lecture seule)

## Ce qui est confirmé par le code et les journaux
- La lecture « vision d'abord » est bien en production : les appels IA d'aujourd'hui (ex. 15:19 UTC, `01a154bf-…`) utilisent le nouveau prompt (`secondary_refs`, règle « ** BL … ** »). Je n'ai **pas** retrouvé l'appel correspondant à cette photo Brive parmi les traces de 12:00 à 15:35 UTC (les corps sont tronqués) : la sortie brute de la vision pour ce document **n'est pas confirmée**.
- Tous les symptômes (n° « 10/2026 », date = date de paiement, une seule ligne « FRAIS DE PORT » sans réf/qté, fournisseur Sarlat) correspondent à la sortie des **règles OCR**, pas à une lecture vision correcte. Deux chemins y mènent :
  1. La vision échoue ou renvoie un JSON illisible → `runDocPipeline` retombe sur l'ancien chemin règles d'abord (`doc-pipeline.ts` l.88-98 : aucun garde-fou si `r` est nul).
  2. La vision laisse des champs vides → `mergeVisionFirst` (`purchase-validate.ts` l.79) les remplit avec les règles sans contrôle de plausibilité ; `invoice_number` n'est même pas comparé.

## Causes par point
1. **Sortie brute / passage à SARLAT** : non tracé pour ce document. Le nom ne vient pas de la résolution des fiches : `resolveSupplier` ne relierait pas « FAURIE AXESS PREMIUM BRIVE » à SARLAT (la règle par mots-clés exige « sarlat »). Le nom erroné est donc **lu** ainsi en amont, par `detectSupplier` (`doc-rules.ts` l.117 : profils appris par mots d'en-tête, ≥3 mots communs) ou un nom explicite. C'est probable, mais pas confirmé.
2. **Établissements Faurie** : `supplier_info` (SIRET/TVA/adresse) n'est utilisé que comme indice secondaire. Il ne bloque jamais un nom lu par les règles, et l'écran ne compare pas le CP/la ville de l'en-tête à la fiche.
3. **N° « 10/2026 »** : regex `doc-rules.ts` ~l.821 `facture … ([A-Z]{0,3}\d[A-Z0-9\-/]{3,})` accepte « / » et capture un fragment de date ; pas de rejet des formes date (`\d{1,2}/\d{4}`).
4. **Date = paiement** : `document_date: labelledBl?.date ?? isoDate(text)` prend la **première date du texte**, sans priorité au libellé « FACTURE N° X du JJ/MM/AAAA » ni exclusion « date de paiement / échéance / règlement ».
5. **Ligne GRILLE perdue** : cause non confirmée (sortie vision absente). Le schéma vision n'a pas de champ « complément / variante » (MX3) : une réf suivie d'un code peut être rejetée par la normalisation des références. À vérifier sur la trace.
6. **PORT traité comme pièce** : le schéma vision et `normalizePurchaseExtract` n'ont aucun `line_kind` ; « PORT / FRAIS DE PORT » devient une ligne pièce sans réf. `shipping_ht` existe dans le contrôle mais n'est jamais renseigné depuis une ligne.
7. **Candidat OSKARBI** : `receptionSuggestions` (`parts-site.ts` l.265-280) **ne filtre pas par fournisseur**. Sans recherche, il renvoie les commandes en attente du site triées par score. Avec une recherche, il filtre sur le texte (désignation « frais de port »). `explainOrderMatch` met bien le score à 0 hors fournisseur, mais la commande reste dans la liste, et `splitByExactRef` la range dans « autres ». C'est confirmé.
8. **Contrôles chiffrés** : `validatePurchase` n'alerte que si `total_ht` est lu. Avec les règles seules (totaux absents ou faux), aucune alerte. De plus, les alertes ne bloquent ni l'affichage ni le rattachement fournisseur.
9. **Relecture ciblée** : elle ne s'exécute que si `result.visionFirst && control_alerts` (`ocr.functions.ts` l.298). Sur le chemin de repli règles (vision nulle), `visionFirst` est faux, donc pas de relecture. Si elle s'exécute, `pickRecheck` ne la retient que si elle passe tous les contrôles ; sinon la première lecture reste, sans blocage.

## Correctif générique recommandé
1. **Échec vision = lecture à vérifier**, pas de retour silencieux aux règles pour les photos : statut « Lecture à vérifier », pas de rattachement fournisseur automatique.
2. **Fusion vision/règles** : n'ajouter un champ des règles que s'il est plausible (n° ≠ forme date, date ≠ date de paiement). Ajouter `invoice_number` aux conflits.
3. **Règles facture** : regex n° excluant les formes date ; date liée au libellé « FACTURE/BL N° … du » prioritaire ; dates « paiement / échéance / règlement / LCR » exclues de `document_date`.
4. **Fournisseur** : SIRET/TVA lus prioritaires. Une fiche dont la ville ou le CP diffère de l'en-tête est rejetée ; le nom de groupe seul (« FAURIE ») n'est jamais suffisant. En cas de conflit nom/SIRET : confirmation.
5. **Vision** : champs `line_kind` (`part|fee|info`) et `variant_code` dans le schéma ; PORT/emballage/consigne → `fee`, comptés dans les totaux, jamais rapprochés comme pièces.
6. **Contrôle bloquant** : si somme lignes ≠ total HT après relecture → bandeau « Lecture à vérifier », lignes non préremplies comme reçues. Relecture aussi déclenchée quand `total_ht` est lu mais que les lignes sont vides ou incomplètes.
7. **Rapprochement** : `receptionSuggestions` et la recherche manuelle filtrent sur `sameSupplier` dès que le fournisseur du document est identifié. Les autres fournisseurs ne s'affichent que sur une action explicite « chercher chez tous les fournisseurs », avec un avertissement.
8. **Traçabilité** : enregistrer `read_provenance` (vision ok/échec, relecture utilisée, champs complétés par les règles) pour diagnostiquer les prochains cas.

## Tests à prévoir (fixture « duplicata facture Faurie Brive », numéros = données de test)
- Vision simulée complète → n° 02-5018641, date 2026-10-16, 2 lignes (GRILLE part 344,34 ; PORT fee 14), totaux cohérents.
- Vision nulle → statut à vérifier, aucun fournisseur rattaché automatiquement.
- Règles : « Date de paiement 30/11/2026 » jamais `document_date` ; « 10/2026 » jamais n° ; regex sans faux positif sur les PDF existants (CAZES/Autodoc/PAD/Renault).
- `resolveSupplier` : « FAURIE AXESS PREMIUM BRIVE » ≠ « FAURIE AUTO SARLAT » ; un SIRET lu l'emporte.
- Une seule ligne 14 € avec HT 358,34 → alerte + relecture ; relecture invalide → lecture à vérifier.
- `receptionSuggestions` : document Faurie identifié → aucune commande OSKARBI, même en cherchant « frais de port ».

## Fichiers concernés
`src/lib/doc-pipeline.ts`, `src/lib/purchase-validate.ts`, `src/lib/doc-rules.ts` (`detectSupplier`, règles facture), `src/lib/purchase-extract.ts`, `src/lib/ocr.functions.ts` (prompt/relecture), `src/lib/supplier-identify.ts`, `src/lib/parts-site.ts` (`receptionSuggestions`, `splitByExactRef`), `src/routes/pieces-achats.reception.tsx` (affichage « à vérifier »).
