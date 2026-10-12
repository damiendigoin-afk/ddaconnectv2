# Diagnostic OR 17007 / BP-680-GW — « Aucune commande pour cet OR »

Lecture seule : rien n'a été modifié ni publié.

## Faits en base
- OR 17007 : `repair_orders.id = 45b92d7a-53ee-4571-bba7-86ccf8f375ce`, site Lalinde `92f38b10-7444-44e1-8d86-84ce6b510a59`.
- Réception OSKARBI du 01/10 : `part_receipts.id = 2276edbd-0a4a-495e-b1dd-544ff810ef78`, `repair_order_id = OR 17007`, **`order_id = null`**, statut validated.
- Réception CAZES du 12/10 : `part_receipts.id = 2e3d343a-1548-42d9-89c6-24c94bae6d4a`, `repair_order_id = OR 17007`, **`order_id = null`**, statut validated.
- `part_orders` : **aucune** commande pour la plaque BP-680-GW ni rattachée à l'OR 17007, ni liée à ces deux réceptions (ni CAZES, ni OSKARBI / Cde 2887974).
- `or_part_usage` : 5 lignes `pending`, quantité 1 chacune (1ed57ad1…, 71de8b59…, 24451896…, ca02d899…, edfddf5c…), bien reliées aux lignes de réception.

## Cause
1. Ces deux BL ont été réceptionnés **sans commande** : il n'existe pas de `part_orders` à relier, donc rien à « mettre à jour » côté commande.
2. Le bouton « Rattacher cette réception à l'OR » (src/components/parts/PendingReceiptsForOr.tsx → `attachReceiptToOr` dans src/lib/parts.ts) fait correctement son travail : il renseigne `part_receipts.repair_order_id` et crée les affectations `or_part_usage` « à pointer ». Le rattachement est donc réel.
3. Le bloc « Statut des pièces » (`PartsStatus` dans src/components/OrActionBoard.tsx, lignes 93-110) ne calcule la complétude qu'à partir des **commandes** (`orPartsOverview(orId).orders` → `partsCompleteness`). Sans commande, il affiche « Aucune commande pour cet OR. », sans regarder les réceptions rattachées ni les affectations. Le compteur juste en dessous (« Au garage / affectées : 5 ») provient lui de `or_part_usage`, d'où l'incohérence à l'écran.

Le maillon qui manque se trouve dans l'affichage, pas dans les données : le statut ignore les réceptions rattachées sans commande.

## Correctif minimal proposé (affichage uniquement, aucune migration)
Dans `PartsStatus` (src/components/OrActionBoard.tsx) :
- Quand il n'y a aucune commande mais au moins une affectation `or_part_usage` active (ou une réception rattachée), afficher « Pièces reçues sans commande — N au garage, à pointer » (style « complet / au garage »), au lieu de « Aucune commande pour cet OR. ».
- Garder « Aucune commande pour cet OR. » seulement s'il n'y a ni commande, ni affectation.
- Avec des commandes, ne rien changer à la règle actuelle.

Ajouter un test pur (dans src/lib/parts-rules.ts : variante de `partsCompleteness` qui reçoit le nombre d'affectations) :
- aucune commande + 5 affectations → « reçues sans commande, 5 » ;
- aucune commande + 0 affectation → « aucune » ;
- commandes présentes → comportement actuel inchangé.

Non retenu : créer une commande fictive après coup, car cela fausserait le suivi des achats et du stock.

En attente de votre validation, aucune modification.
