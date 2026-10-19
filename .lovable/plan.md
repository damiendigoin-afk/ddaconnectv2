# Diagnostic BL FAURIE AUTO SARLAT 916076 (et 916084)

Lecture seule : aucun code ni aucune donnée modifiés. Ce qui est « confirmé » ci-dessous vient du code. Ce qui est « probable » reste à vérifier sur le texte OCR brut, qui n'est pas enregistré.

## 1. Bloc « Repères atelier / N° lus / 20 × … PU … »
- **Où il est construit** : `pieces-achats.reception.tsx:230-233`. Il affiche tel quel `x.lines` (`docLines = x.lines`, ligne 188), donc les lignes déjà lues par `purchaseRules` (`doc-rules.ts`) puis passées par `normalizePurchaseExtract` (`purchase-extract.ts`).
- **Pourquoi c'est faux** : le format FAURIE n'a pas de gabarit dédié. Les règles génériques (`parseItemLines` / lecteur tolérant, `doc-rules.ts:~270`) découpent mal ses colonnes (réf · désignation · qté · tarif HT · remise % · montant HT · TVA % · TTC). Origine probable de chaque valeur fausse :
  - **qty 20** : la quantité est cherchée dans un petit entier isolé en fin de zone (`tailInt` / `afterPrice`). C'est la colonne « TVA 20 % » qui est prise.
  - **PU 4500109.88** : le motif de montant accepte les séparateurs de milliers par espace ou point (`\d{1,6}(?:[ .]\d{3})*[.,]\d{2}`). Ainsi « 45,00 % 109,88 » se lit comme un seul nombre, ou « 4500 » s'accole devant 109,88.
  - **7M945852 et 0.77** : l'OCR lit « 11 » comme « M ». La référence dégradée fait décaler les montants. Ensuite `normLine` recalcule PU = montant ÷ qté avec qté = 20, soit 15,41 ÷ 20 = 0,77. C'est cohérent avec la quantité fausse.
- **Pourquoi la vision n'a pas corrigé** : des lignes existent, donc le champ requis « lines » est rempli. Aucun contrôle du type somme des lignes = total HT, ou tarif × (1 − remise) = montant, ne les marque comme douteuses.

## 2. Cartes de réception correctes
- Ces cartes ne viennent **pas** du BL. Après « Rapprocher » / « Confirmer l'association », les lignes viennent de la **commande** (`part_order_lines` : `qty_ordered`, `expected_unit_cost_ht`, `physical_reference`). C'est pourquoi on y voit « Commandée 1 » et le PA 109,88 / 15,41 de la commande.
- `receiptLinesFromDoc(x.lines)` (ligne 423) ne sert qu'en réception sans commande. Il y a donc deux sources différentes : les lignes lues sur le BL (fausses) et les lignes de la commande (justes).
- **Question 8** : « Commandée » s'affiche seulement une fois une commande associée. Cela ne valide rien avant le clic, mais il y a un risque : la quantité reçue préremplie peut reprendre le reliquat de la commande au lieu de la quantité réellement livrée. Si le BL était lu correctement, la comparaison BL / commande (`compareDocToOrder`) l'aurait signalé. Avec qty 20 lue, elle signale à tort « au-delà du reliquat ».

## 3. 916076 et 328167
- 916076 est le n° du **duplicata de bon de livraison**. « ** BL 328167 DU … ** » est une **ligne d'information du tableau**, qui renvoie au BL d'origine ou au BL du magasin.
- `purchaseRules` retient le **premier** « bon de livraison / BL + n° » trouvé dans le texte. Ici c'est 916076, par chance. Si la ligne du tableau avait été lue avant l'en-tête, ce serait 328167. « N° lus » affiche les deux, car `ref_candidates` / identifiants regroupe tous les numéros trouvés.
- **Attendu** : `delivery_note_number` = le n° qui suit « (duplicata de) bon de livraison n° … du … » dans l'en-tête. Le n° de la ligne « ** BL … DU … ** » est gardé comme référence secondaire (`source_bl_ref` ou `ref_candidates`). Cette ligne ne doit jamais devenir une ligne de pièce. La règle repose sur le libellé, pas sur les valeurs.

## 4. Rapprochement : OR 51189 contre OR 51146 / 51148
- `matchOrders` / `receptionSuggestions` (`parts-site.ts:132-236`) respecte déjà la priorité métier. Une référence lisible exige au moins une référence exacte commune, et une désignation proche n'apporte aucun point (ligne 173). **OR 51189 est donc proposé à juste titre**, grâce à 7717297600.
- La deuxième référence exacte (7711945852) n'a pas été comptée, car le BL donne « 7M945852 ». Le score ne monte pas autant qu'il le devrait.
- **OR 51146 et 51148 ne viennent pas de `matchOrders`.** Ils viennent très probablement de la liste manuelle `searchPendingOrders` (`parts-site.ts:259`). Cette liste montre **toutes** les commandes en attente du site et du fournisseur, triées par pertinence, donc aussi celles sans aucune référence commune. Le texte « désignation proche » affiché sur ces cartes est à localiser précisément dans l'écran avant de corriger.
- Un écart de points trop faible : la 2e référence exacte rapporte +1 et la 3e +1, contre +3 pour la première. Une commande qui contient les deux références du BL ne se détache pas assez.
- **Partiel 2 lignes sur 3 (question 7)** : déjà couvert. `compareDocToOrder` classe la bougie 8550503297 en `not_in_doc`, sans quantité reçue. À garder dans les tests.

## Correctif recommandé (minimal, générique)
1. **Une seule source pour les lignes du BL** : ajouter dans `doc-rules.ts` un lecteur « tableau avec colonnes remise % et TVA % ». Repérer la ligne d'en-tête des colonnes, puis, pour chaque ligne :
   - ignorer les pourcentages (`\d+,\d{2}\s*%`) et les petits entiers suivis de « % » comme quantité ;
   - refuser un montant à espace des milliers si les deux morceaux sont séparés par « % » ;
   - vérifier que tarif × (1 − remise) × qté = montant HT (à 0,02 € près), sinon la ligne est marquée douteuse.
2. **Contrôle global** : somme des montants HT = total HT, et HT + TVA = TTC. En cas d'écart, `lines` va dans `_suspect`, ce qui relance la vision et remplace les lignes douteuses (mécanisme existant de `mergeAi`). Une alerte de contrôle s'affiche comme pour Renault.
3. **Référence corrigée par la commande** : quand une référence lue ne correspond à aucune commande mais diffère d'une seule confusion OCR (M↔11, O↔0, I↔1) d'une référence de **la même commande candidate**, l'écran le propose comme écart à confirmer. Aucune correction n'est faite automatiquement.
4. **N° de BL** : priorité au libellé « (duplicata de) bon de livraison n° X du date ». La date du document est celle de ce libellé. Les lignes « ** BL … DU … ** » sont gardées comme référence secondaire et exclues des lignes de pièces.
5. **Points de rapprochement** : chaque référence exacte compte au moins autant que la première, plus un bonus quand toutes les références du BL sont dans la commande. Dans la liste manuelle, les commandes sans référence commune vont dans un groupe replié « Autres commandes du fournisseur ».
6. **Bloc « N° lus »** : afficher l'alerte de contrôle quand les lignes sont douteuses, au lieu de montrer « 20 × … PU 4500109.88 » comme une valeur fiable.

## Tests à prévoir (fixture texte synthétique Faurie 916076 / 916084)
- Lignes lues : 7717297600 qté 1 PU 109,88 et 7711945852 qté 1 PU 15,41. La TVA 20 n'est jamais prise pour une quantité, et la remise 45,00 ne colle jamais au montant.
- Somme 125,29 = total HT. Une variante altérée donne une alerte et marque les lignes douteuses.
- `delivery_note_number` = 916076, et 328167 est conservé à part, même si la ligne « BL 328167 » apparaît en premier dans le texte.
- Variante OCR « 7M945852 » : proposée comme écart vers 7711945852 de la commande candidate, jamais appliquée seule.
- Rapprochement : une commande avec les deux références exactes passe devant une commande « FILTRE A HUILE VALUE+ », qui n'apparaît pas dans les propositions. Commande à 3 lignes : la bougie est `not_in_doc` et n'est pas reçue.
- 916084 : « 284421319R CAMERA AIDE STATIONNEMENT » et la variante collée « 284421319RCAMERA » donnent « CAMERA… », remise 13 % et 88,56.
- Non-régression avec les fixtures actuelles (Renault, BL 914963 / 914776, PAD) et `reception-confirm-gaps`.

## Fichiers concernés
`src/lib/doc-rules.ts` (lecteur des lignes, n° de BL, contrôle des totaux), `src/lib/doc-pipeline.ts` (lignes douteuses ⇒ vision), `src/lib/purchase-extract.ts` (garder la référence secondaire du BL), `src/lib/parts-site.ts` (`explainOrderMatch`, `searchPendingOrders`), `src/routes/pieces-achats.reception.tsx` (bloc « N° lus » et regroupement des candidats), plus les tests.

## Points ouverts
- Récupérer le texte OCR brut du BL 916076 pour confirmer l'origine exacte de 20, 4500109.88 et 0.77.
- Localiser dans l'écran le texte « désignation proche » des cartes OR 51146 / 51148.
- Les causes du plan précédent (« SEJ1ND SA », date 2016, « AMERA ») restent valables et seront traitées dans le même lot.
