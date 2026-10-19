# Diagnostic lecture BL FAURIE AUTO SARLAT (916076 / 916084)

Lecture seule : aucun code ni aucune donnée modifiés. Les causes ci-dessous viennent de la lecture du code. Elles ne sont pas encore confirmées sur le texte OCR brut de ces deux BL, qui n'est pas enregistré.

## Pipeline actuel (Réception pièces)
1. Texte OCR local ou couche texte du PDF (`doc-text.browser.ts`), puis `runDocPipeline` (`doc-pipeline.ts`).
2. Règles déterministes `purchaseRules` (`doc-rules.ts:742`). Ordre : gabarit Renault « Détail de commande », gabarit Logiweb, puis règles génériques. **Il n'existe aucun gabarit pour le BL / duplicata FAURIE.**
3. Si un champ requis manque (fournisseur, lignes, date) : IA sur le texte, puis vision sur l'image. Pour une photo, la vision passe même si le repli IA est coupé. `mergeAi` ne remplit que les champs vides. Un champ déjà lu, même faux, est conservé.
4. Choix du fournisseur : `detectSupplier`, sinon `headerSupplierName`. Ensuite `resolveSupplier` (`supplier-identify.ts`) compare avec les fiches : alias en dur, n° de TVA/SIRET dans les notes, nom exact, nom contenu, mots communs. Sans correspondance, le résultat vaut « new » et l'écran propose de créer le fournisseur.
5. Dernier passage : `normalizePurchaseExtract` (`purchase-extract.ts`).

## Causes
**916076, fournisseur « SEJ1ND SA »** (cause très probable) :
- `detectSupplier` ne reconnaît une fiche que si son nom ou un alias figure **mot pour mot** dans le texte. Avec une petite erreur de lecture sur « FAURIE AUTO SARLAT », rien ne correspond. Le repli par mots d'en-tête appris demande au moins 3 mots communs, et l'adresse lue de travers (« CROIX D'ALLON ») les fait perdre.
- `headerSupplierName` (`doc-rules.ts:411`) prend alors la **première ligne des 8 premières se terminant par une forme juridique**. Un bout de texte illisible terminé par « SA » suffit (`LEGAL` accepte `SA`). La ligne FAURIE, sans forme juridique, est ignorée.
- La valeur est fausse mais non vide, donc la vision ne la corrige pas. Le n° de TVA FR35879194751 n'est utilisé que s'il est déjà noté dans la fiche fournisseur. Et rien ne fait le lien entre le site www.faurie.fr ou l'adresse et la fiche.
- Résultat : `resolveSupplier` renvoie « new » et l'écran propose de créer un fournisseur.

**BL, date et total** :
- Le n° de BL est le premier motif « bon de livraison / BL » suivi de chiffres trouvé n'importe où. Le libellé « duplicata de bon de livraison n° … du … » n'est pas lu de façon ciblée. Un 9 lu comme 0 donne 0974076.
- `document_date = isoDate(text)` prend la **première date du texte**, sans lien avec le n° de BL. Aucun contrôle de vraisemblance n'écarte une date 2016.
- Le total HT est le dernier montant d'une ligne « total/montant HT ». Il n'est **pas validé** contre la somme des lignes (109,88 + 15,41 = 125,29) ni contre l'égalité HT + TVA = TTC. Cette validation n'existe que dans le gabarit Renault.

**916084, « AMERA » au lieu de « CAMERA »** (hypothèse à confirmer sur le texte brut) :
- La référence `284421319R` est suivie de « CAMERA ». Si l'OCR colle les deux ou lit un séparateur parasite, la référence absorbe le « C » : `REF` et `refTok` acceptent les lettres en fin de jeton.
- Autre piste : `brandColumn` supprime le premier mot quand une colonne marque est supposée.
- Aucun contrôle ne vérifie que la référence fait la longueur habituelle d'une référence Renault (10 caractères) ni que la désignation commence par un mot entier.

## Correctif recommandé (générique)
1. **Signatures fournisseur** : une identité par fiche (raison sociale, n° de TVA, SIRET, site web, code postal + rue), enregistrée dans les notes, comme les alias actuels. Le n° de TVA, le site web ou « CP + rue » d'une fiche connue passent **avant** `headerSupplierName`. Pour FAURIE AUTO SARLAT, il suffit d'ajouter dans sa fiche le n° de TVA FR35879194751 et le site faurie.fr. Rien n'est écrit en dur dans le code.
2. **Comparaison tolérante aux erreurs OCR** du nom (FAUR1E, AUT0…) dans les premières lignes, seulement si une seule fiche est proche. En cas d'égalité, l'écran demande de choisir.
3. **Pas de proposition de création si la confiance est faible** : le fournisseur venant de `headerSupplierName` est marqué douteux. Si une signature d'une autre fiche est présente, ou si le nom lu est court ou illisible, la vision est relancée sur le champ fournisseur (champ douteux remplacé, comme `_suspect`). L'écran demande alors de choisir une fiche au lieu de proposer « Créer ».
4. **BL et date lus dans leur zone** : motif prioritaire « (duplicata de )?bon de livraison n° X du JJ/MM/AAAA ». La date liée au n° de BL l'emporte sur la première date du texte. Une date à plus d'un an de la date du jour est signalée comme douteuse.
5. **Contrôle des montants** : la somme des lignes HT doit égaler le total HT (à 0,02 € près) et HT + TVA doit égaler TTC. En cas d'écart, les champs concernés sont signalés, la vision est relancée, et l'écart est affiché comme pour le gabarit Renault.
6. **Lignes par colonnes** (réf, désignation, qté, tarif, remise %, montant HT) : tarif × (1 − remise) × qté doit donner le montant. Une référence de longueur anormale, suivie d'une désignation qui ne commence pas par un mot entier, est découpée à nouveau pour rendre la lettre à la désignation.

## Tests à prévoir
- Fixtures de texte OCR **synthétiques**, reprises de ces deux BL (en-tête, duplicata, tableau, bloc montant), avec quelques erreurs (FAUR1E, CROIX D'ALLON, 9 lu 0, ligne parasite « … SA »). Les n° de BL servent seulement de valeurs attendues, jamais de règle dans le code.
- Fournisseur trouvé par n° de TVA ou site web même avec un nom illisible. Fournisseur jamais « new » si la signature d'une fiche est présente. FAURIE Sarlat et Bergerac restent bien distincts.
- BL et date lus depuis « duplicata … du … ». La date 2016 n'est pas retenue.
- Totaux : 125,29 / 25,06 / 150,35 cohérents, et un écart provoque une alerte.
- Remise : 199,78 × 0,55 = 109,88 et 101,79 × 0,87 = 88,56.
- « 284421319R CAMERA … » et sa variante collée donnent la désignation « CAMERA AIDE STATIONNEMENT ».
- Non-régression avec les fixtures actuelles : Renault 46104548, 45954556, BL 914963 et 914776, PAD/OSKARBI.

## Fichiers concernés
`src/lib/doc-rules.ts` (`purchaseRules`, `detectSupplier`, `headerSupplierName`, `parseTolerantLines`/`parseItemLines`, `isoDate`), `src/lib/supplier-identify.ts` (`resolveSupplier`, `supplierIds`), `src/lib/doc-pipeline.ts` (suspect ⇒ vision), `src/lib/purchase-extract.ts`, `src/routes/pieces-achats.reception.tsx` (pas de proposition « Créer » si faible confiance), nouveaux tests dans `src/lib/__tests__/`.

## Avant de coder
Récupérer le texte OCR brut d'au moins un des deux BL (photo à rescanner, ou texte journalisé) pour confirmer les causes « SEJ1ND SA » et « AMERA ».
