# Diagnostic scan OR WinMotor → tour véhicule (lecture seule)

Aucune modification n'a été faite. Ce plan liste ce qui est démontré, ce qui reste une hypothèse, et des correctifs classés par priorité, à appliquer seulement après votre accord.

## 1. Parcours réel (lu dans le code)

```text
Photo (compressée 1800 px) -> Tesseract local (localDocText, nouvelle passe si orScanNeedsRetry)
 -> ocrRepairOrder -> runDocPipeline("repair_order")
     règles repairOrderRules -> sanitizeRepairOrder
     si champ requis manquant ou suspect : IA texte (si le repli est activé) puis vision (Gemini 3.5 Flash)
     fusion mergeAi : l'IA remplit les vides ET remplace les champs "suspects"
 -> decideOrScan / decideTourScan (n° OR = 3 à 8 chiffres)
 -> [tour seulement] prioritizeRefVehicleIdentity (référentiel)
 -> ensure_winmotor_dossier_full (SQL) -> crée véhicule/client/OR local -> startQuickTour
```

Le scan OR n'utilise PAS le mode vision d'abord (`visionFirst` est réservé aux achats). La vision ne se lance que si les règles laissent un champ manquant ou suspect.

## 2. Causes démontrées

**A. Plaque 50690 = numéro d'OR (Castillon, OR 50690)**
- Le contrôle strict de la plaque (`strictPlate`) n'existe que côté lecture. Le SQL `ensure_winmotor_dossier_full` accepte toute valeur de 4 à 12 caractères (`length(_plate) < 4 OR > 12`), sans format SIV/FNI et sans comparer avec le n° d'OR.
- Seul chemin qui contourne la lecture : la saisie manuelle « plaque demandée » de l'Atelier (`plateIn`, envoyée telle quelle), ou une valeur passée par `ensureWinmotorDossier({ plate })` qui écrase un champ vide. Aucun historique WinMotor pour 50690 (vérifié) : la plaque ne vient donc pas des factures.
- Hypothèse la plus probable : n° d'OR tapé dans le champ plaque après `needs_plate`. Non prouvable sans journal.

**B. Marque incohérente avec le modèle (CX-528-KM « RENAULT CEED2 SPORT WAGON », BK-859-HG « RENAULT NAVARA »)**
- Pas de fiche référentiel ni WinMotor pour ces plaques (vérifié) : ces valeurs viennent de la lecture.
- `sanitizeRepairOrder` vérifie seulement que la marque est dans une liste (`CAR_BRANDS`), jamais qu'elle correspond au modèle. Sur un OR d'agent Renault, « Renault » est imprimé partout (logo, « Renault care service », « Agent Renault ») : les règles comme l'IA prennent facilement RENAULT par défaut. La consigne IA donne aussi « RENAULT, DACIA » comme seuls exemples.
- Aucune table modèle → marque n'est consultée.

**C. Modèle pollué par un e-mail (EY-499-DY « TRAFIC 1 CB LIHIP) MB emoil akocendre@hotmail.com_ »)**
- `isPlausibleModel` refuse seulement : pas de lettre, ou égal à un n° compte/OR/CP/téléphone/plaque. Il ne refuse ni « @ », ni « email/emoil », ni une longueur excessive, ni un texte de plusieurs colonnes collées.
- Le modèle étant non vide et jugé plausible, il n'est pas « suspect » : la vision ne le corrige pas.
- Le SQL recopie `brand`/`model` sans aucun contrôle.

**D. Plaque mal lue BK-859-HQ au lieu de HG**
- `strictPlate` corrige les sosies seulement dans le bloc chiffres ; une lettre G/Q dans les blocs lettres est un SIV valide et passe telle quelle. Aucune vérification croisée (VIN, référentiel, deuxième lecture) n'est faite avant de créer le véhicule.

**E. Client absent (8/50 tours, 7 Castillon) — mécanisme**
- Volontaire par construction (règle « Scan OR » existante) : si le nom est pollué par l'en-tête garage ou manquant, aucun client n'est créé ; les contacts vont dans `or_client_captures`. C'est un comportement de sécurité, mais l'utilisateur n'est pas obligé de résoudre la capture avant de lancer le tour.
- Le nettoyage d'en-tête garage contient des motifs spécifiques Castillon (`SAS CASTILLON VEYSSIERE`, `/castillon|digoin|veyssi/`) : toute lecture où le nom touche l'en-tête Castillon est vidée ou marquée suspecte.

**F. Kilométrage absent (11/50) et e-mail absent (19/50)**
- Kilométrage : volontairement lu seulement s'il est libellé et lisible (souvent manuscrit) ; aucune relance au tour (le compteur peut être photographié au tour, mais rien ne l'impose).
- E-mail : mis à vide s'il ressemble au garage, et marqué suspect si dégradé ; normal qu'il manque souvent.

**G. Aucune trace exploitable**
- `ai_usage_log` (feature `ocr_or`, 87 appels/15 j) : `site_id` et `route` toujours vides. On ne sait pas, par garage, quelle voie (règles seules / IA texte / vision) a produit chaque fiche.
- Aucune photo d'OR conservée dans le stockage (0 fichier) : pas de comparaison possible sur les vraies photos passées.
- `prioritizeRefVehicleIdentity` (tour) met à jour directement `vehicles` depuis le référentiel sans conflit ni trace.

## 3. Pourquoi Castillon est plus touché (démontré vs hypothèse)
- Démontré : 25 tours chacun ; Castillon 7 sans client et 6 sans modèle contre 1 et 0 pour Digoin. Les cas 50690 et 051298 (n° d'OR à 0 initial) sont à Castillon.
- Démontré : règles d'en-tête garage spécifiques Castillon qui vident/rendent suspects nom et modèle.
- Hypothèse (à confirmer sur photos) : mise en page de l'OR Castillon (en-tête « Castillon Veyssière » plus large, colonnes Immat/Marque/Modèle décalées) qui fait coller les colonnes ; usage plus fréquent de la saisie manuelle de plaque ; qualité/éclairage des photos.
- Impossible à prouver aujourd'hui, faute de journal par site et de photos.

## 4. Correctifs proposés (par priorité)

**P1 — Bloquer les données impossibles (déterministe, sans IA)**
1. Contrôle plaque côté serveur et SQL : format SIV/FNI obligatoire, refus si égal au n° d'OR / n° compte ; même règle pour la saisie manuelle « plaque demandée ».
2. Modèle : refuser « @ », mots e-mail/tél, longueur > 40, plus de 4 mots ; marquer suspect pour déclencher la vision.
3. Cohérence marque ↔ modèle via une petite table de modèles connus (CEED→KIA, NAVARA→NISSAN, TRAFIC→RENAULT…) : en cas de conflit, marque marquée suspecte, jamais corrigée en silence.
4. Même nettoyage repris dans `ensure_winmotor_dossier_full` (dernier rempart).

**P2 — Lecture plus fiable sans revenir au seul OCR**
5. Pour une photo d'OR, passer en vision d'abord (comme les BL) avec règles en complément, ou au minimum : vision lancée si plaque/modèle/nom suspects, même quand tous les champs sont remplis.
6. Prompt : retirer RENAULT comme valeur implicite ; préciser que le logo/en-tête n'est jamais la marque du véhicule.
7. Vérification croisée plaque : comparer Tesseract et vision ; si différence d'un caractère, demander confirmation avant création.

**P3 — Écran de contrôle avant création**
8. Après lecture, afficher plaque/marque/modèle/nom/km avec les champs douteux surlignés ; confirmation obligatoire si suspect, client absent ou km absent avant de lancer le tour.
9. Au tour : proposer de résoudre la capture client et de saisir/photographier le km si absent.
10. `prioritizeRefVehicleIdentity` : proposer le conflit au lieu d'écrire directement.

**P4 — Traçabilité**
11. Renseigner `site_id` et `route` dans `ai_usage_log` pour `ocr_or`.
12. Conserver la photo d'OR 30 jours (stockage privé) avec la provenance par champ (règles/IA texte/vision/saisie).

## 5. Plan de tests comparatifs
- Aujourd'hui aucune vraie photo n'est conservée : il faut d'abord collecter 20–30 photos d'OR (moitié Castillon, moitié Digoin), dont celles des cas cités.
- Banc existant (Recette IA, isolé) : pour chaque photo, comparer règles seules, voie actuelle, vision d'abord ; mesurer par champ (plaque, marque, modèle, nom, km, e-mail) contre une saisie de référence, par garage.
- Tests automatiques sur textes figés : plaque = n° OR refusée ; modèle avec e-mail refusé ; RENAULT + CEED = suspect ; G/Q en bloc lettres demande confirmation ; SQL refuse une plaque non conforme.
- Critère d'acceptation : zéro plaque/modèle impossible ; taux de champs complets par garage au moins égal à l'actuel.

## Détails techniques
- Fichiers concernés : `src/lib/doc-rules.ts` (`sanitizeRepairOrder`, `isPlausibleModel`, `CAR_BRANDS`, `repairOrderRules`), `src/lib/plate.ts` (`strictPlate`), `src/lib/doc-pipeline.ts` (`visionFirst` limité à `purchase`, dans `doc-pipeline.server.ts`), `src/lib/ocr.functions.ts` (prompt OR), `src/lib/or-dossier.ts`, `src/routes/atelier.index.tsx` (`plateIn`), `src/routes/tour-vehicule.tsx`, `src/lib/refbase.ts` (`prioritizeRefVehicleIdentity`), migration `0055_ensure_dossier_capture_same_identity.sql`.
- Les corrections SQL passeraient par une nouvelle migration additive ; aucune donnée existante ne serait réécrite automatiquement (une liste de fiches suspectes peut être produite pour correction manuelle).
