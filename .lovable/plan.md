# Analyse CW-862-AY — constats (lecture seule, rien modifié ni publié)

## 1) Pourquoi PNEUS AV reste « dimension à confirmer »

Points pneus en base (inspection 90726d96…):

| Point | Statut | Mesure | Dimension (tire_analysis final / ai) |
|---|---|---|---|
| pneu_avd | watch | — | aucune (pas d'analyse) |
| pneu_avg | ok | 3 mm | 155/65R14 / 155/65R14 |
| pneu_arg | watch | — (NaN neutralisé) | 155/65R14 / 155/65R14 |
| pneu_ard | watch | — | aucune |
| etiquette_pneus | unset | — | tire_label vide |

Autres sources: véhicule Peugeot 1.0 12V (2005): `tire_size_front` et `tire_size_rear` vides. Aucune offre `tire_quote_offers` sur un point avant. Pas de taille homologuée exploitable.

Cause (code `tireGroups` dans tour-pricing): la dimension d'un bloc ne vient que des pneus signalés (defect/watch). À l'avant, seul pneu_avd est signalé et n'a pas d'analyse. Ensuite viennent la mémoire véhicule et la taille homologuée, toutes deux vides. pneu_avg, qui a la dimension 155/65R14, est « OK » : il n'est jamais lu.

Peut-on trouver l'avant sans inventer ? Oui : la dimension a été relevée sur pneu_avg, sur le même essieu (même monte gauche/droite). La réutiliser pour pneu_avd n'invente rien. On aurait alors AV 155/65R14 = AR 155/65R14. Selon la règle, cela donnerait un seul bloc « 4 PNEUS ». Changer la règle (lire aussi les pneus OK du même essieu) reste une décision à valider par vous.

## 2) Message PDF `__extends` dans la notification Front Office

- Il n'existe qu'une ligne de notification: id 4b1db002…, status `sent`, sent_at 15:23:52 UTC (17:23:52 heure de Paris), photo_count 6, updated_at 15:36:34.
- Le texte d'erreur est celui de cet envoi de 17:23:52. Le 15:36 correspond à la correction du compteur de photos (0 passé à 6). Aucun renvoi n'a eu lieu depuis le correctif.
- Le correctif est bien présent dans le code : `tslib` passe en 2.8.1 via les overrides, et un vrai %PDF a été produit par le test serveur. En revanche, la production ne l'a pas encore prouvé : aucun envoi n'a été fait après la publication. Seul un renvoi manuel le confirmera : une nouvelle ligne sans erreur s'ajoutera, et l'ancienne restera dans l'historique.

## 3) Chiffrage arrière

- tire_quote_offers (pneu_arg, créées à 15:23:57) : exactement 7 lignes, sans doublon.
  - identique Cooper hiver 167,78 € — **sélectionnée**
  - Été entrée Sailun 134,95 € ; Été milieu Kleber (sans prix) ; Été haut Michelin (sans prix)
  - 4 saisons entrée Sailun 136,13 € ; milieu Kleber 156,29 € ; haut Michelin (sans prix)
  - Aucune offre hiver parmi les 6 alternatives.
- Devis :
  - Ancien devis b8d9514e (15:23:58, brouillon) : 175,78 €. Il contient les 2 anciennes lignes (Cooper 167,78 € et une ligne générique à 8 €). Il est conservé, rien n'a été supprimé.
  - Nouveau devis 59d1c54b (16:04:10, brouillon) : **167,78 €**.
    - « PNEUS AR — 155/65 R14 — 2 pneus » : 7 offres, choix retenu = Équivalence, 167,78 €.
    - « PNEUS AV — dimension à confirmer — 2 pneus » : 7 cases, 0 € (aucun prix inventé).
- Conclusion : l'arrière est correct, et le total ne compte que l'offre retenue. Point de vigilance : 3 des alternatives n'ont pas de prix fournisseur. Elles doivent s'afficher comme indisponibles.

## Suite proposée (seulement si vous validez)
1. Pour la dimension, tenir compte aussi d'un pneu « OK » du même essieu qui a une dimension relevée. Avec cette règle, CW-862-AY passerait en « 4 PNEUS 155/65R14 ». Tests à l'appui.
2. Faire un renvoi manuel Front Office pour prouver que le PDF est généré en production.
