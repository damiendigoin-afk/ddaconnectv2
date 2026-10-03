# Scan OR Atelier : fonctionnement actuel et correctif proposé

## 1. Comment fonctionne le scan aujourd'hui (un mélange)

```text
Atelier > Scanner OR (src/routes/atelier.index.tsx, scanOr)
  1. compressImage 1800 px
  2. localDocText (src/lib/doc-text.browser.ts)  -> Tesseract local, 0 crédit
       2e passe binarisée si orScanNeedsRetry (pas d'immat ou pas de n° OR lus)
  3. ocrRepairOrder (src/lib/ocr.functions.ts) -> readDocument -> runDocPipeline
       a. repairOrderRules (src/lib/doc-rules.ts) : libellés + regex
       b. sanitizeRepairOrder : retire valeurs parasites (garage, conseiller)
       c. champs obligatoires manquants (n° OR, immat, travaux/remarque, nom, modèle)
          -> photo = vision Gemini 3.8 Flash obligatoire (askVision)
       d. fillMissing : la vision ne complète QUE les champs vides
  4. parseRepairOrderScan -> decideOrScan -> ensure_winmotor_dossier_full
     (récupération fiche complète : inchangée)
```

Journal des coûts : le 03/10, deux lectures à 15:26 et 15:27 sont passées par la vision Gemini 3.8. Celle de 15:29 a été lue entièrement en local, sans IA.

## 2. Causes probables

**Immat EMA426NG au lieu de EM426NG : vient de l'IA vision, pas des règles locales.**
- La recherche locale (`findFrenchPlate`, src/lib/plate.ts) n'accepte que le format AA-123-AA. Elle ne peut pas produire « EMA426NG ». Sur la photo, elle n'a donc rien trouvé, sans doute à cause de la police de la plaque.
- La vision a alors renvoyé « EMA426NG ». Aucune étape ne vérifie le format de l'immatriculation venant de l'IA : `sanitizeRepairOrder` ne la contrôle pas. `formatPlate` laisse passer une valeur hors format sans la modifier, puis l'Atelier l'utilise.

**Numéro de compte pris pour le modèle : deux chemins possibles (non confirmé sans la photo).**
- Règles locales : sur l'OR Renault, les libellés sont en tableau (« Immat. Marque Modèle N° compte » sur une ligne, valeurs sur la ligne suivante). `orLabeledValues` lit la valeur sur la même ligne, ou bien la ligne suivante, mais seulement pour le dernier libellé de la ligne. Les colonnes ne sont pas alignées entre elles, et l'OCR lit parfois mal le libellé (« Modile », vu dans un exemple de test). Une valeur peut donc tomber sous le mauvais libellé.
- IA : la consigne demande seulement « Modèle = valeur du libellé modèle véhicule ». Aucun contrôle ne rejette un modèle purement numérique : `sanitizeRepairOrder` exige seulement 2 caractères alphanumériques, et « 012384 » passe.

## 3. Correctif proposé (simple, sans toucher à la récupération de fiche)

1. **Contrôler l'immatriculation dans `sanitizeRepairOrder`.** Cette étape s'applique aussi bien aux règles locales qu'à l'IA. Toute immatriculation passe par `findFrenchPlate`, avec correction des confusions courantes de l'OCR. Si le format n'est pas valide (AA-123-AA ou ancien format), elle est mise à vide et marquée « rejetée ». Une valeur douteuse ne part donc jamais vers la fiche. L'écran demande alors l'immatriculation, comme il le fait déjà.
2. **Réparer « EMA426NG » sans rien inventer.** Une lettre en trop est retirée seulement si une seule version au bon format est possible. Exemple : EMA426NG donne EM-426-NG si on retire le A, mais aussi EA-426-NG si on retire le M. Comme deux versions sont possibles, la valeur est rejetée. Si l'immatriculation lue sur la même photo par l'OCR local correspond à l'une des versions, c'est celle-là qui est gardée.
3. **Contrôler le modèle.** Un modèle doit contenir au moins une lettre et ne peut pas être purement numérique. Il est aussi rejeté s'il est identique au n° de compte, au n° d'OR, au code postal ou au téléphone lus sur le même document.
4. **Lire les en-têtes en tableau Renault.** Quand une ligne contient plusieurs libellés et que les valeurs sont sur la ligne suivante, les valeurs sont réparties par position de colonne. L'immatriculation est reconnue par son format, le n° de compte par ses chiffres seuls. Les libellés mal lus par l'OCR (« Modile », « Merque ») sont tolérés.
5. **Renforcer la consigne donnée à l'IA.** Elle précise : « plate = format français AA-123-AA (2 lettres, 3 chiffres, 2 lettres) ; ne jamais mettre le n° de compte client dans model ». Les contrôles des points 1 et 3 restent le vrai garde-fou.
6. **Tests.** Ils couvrent : EMA426NG rejetée ou ramenée à EM-426-NG grâce à la lecture locale ; un modèle « 012384 » rejeté ; un en-tête en tableau Renault avec modèle et compte bien séparés ; les tests existants de l'OR 50873 et de la photo d'OR, qui doivent rester verts.

Aucun changement à `ensure_winmotor_dossier_full`, `decideOrScan`, à la gestion des conflits ni au parcours d'ouverture.

## Détails techniques
- Fichiers touchés : `src/lib/doc-rules.ts` (sanitizeRepairOrder, orLabeledValues), `src/lib/plate.ts` (fonction de réparation stricte de l'immatriculation), consigne dans `src/lib/ocr.functions.ts`, tests dans `src/lib/__tests__/`.
- Une valeur rejetée compte comme champ manquant. Elle déclenche donc la vision si elle n'a pas encore été appelée, et ne sera jamais réinjectée telle quelle.
- Pour confirmer le chemin exact du modèle mal lu : rejouer la photo réelle dans l'aperçu et lire le texte OCR local. Vous pouvez aussi me fournir la photo pour en faire un exemple de test.
