# Diagnostic GY-640-HM — puissance 0 / champs codés (lecture seule)

## Faits démontrés (code + base)

1. **La fiche n'a jamais été écrite par IXELLIO.** Ligne `ref_vehicles` 253e4f3d… : `source_system = winmotor`, `import_id` b142b9d5…, `source_raw = null`. Or l'enregistrement IXELLIO (`saveVehicleFromIxellio`, `src/lib/ixellio-vehicle.server.ts`) pose toujours `source_system = "ixellio"` et remplit `source_raw` avec puissances brutes. Les valeurs « 0 », `ESV3M26W2HY`, `RHNHH1F25W16100000`, `S017479`, `H5F_601`, `HYB` viennent donc de l'export WinMotor (codes constructeur), pas d'IXELLIO.
2. **Le 0 est une chaîne "0" importée telle quelle.** `src/lib/winmotor/mapping.ts` l.219-220 : `power_hp: p([...]) || null`. La chaîne `"0"` est « vraie » en JS, donc conservée ; elle n'est jamais convertie en null. Ce n'est pas un null remplacé par 0 côté DDA : WinMotor exporte 0.
3. **Confusion d'unités dans l'import WinMotor** : `power_hp` lit d'abord la colonne « Puissance fiscale » / « Puissance CV » (CV fiscaux ≠ ch). Bug latent pour d'autres véhicules.
4. **IXELLIO ne peut pas corriger ces champs ensuite** : la complétion depuis la fiche (`planFillEmpty`, `src/lib/ixellio-map.ts` l.87-110, appelée par `RefVehicleActions.tsx`) ne remplit que les champs vides ; `"0"` n'est pas vide (`isEmpty` ne teste que null/""), donc 199 ch serait affiché en « conservé » et jamais écrit. Idem modèle/version/boîte déjà remplis par codes.
5. **Un ré-import WinMotor écrase tout** : `src/lib/winmotor/ingest.ts` l.283/319 fait un `upsert` complet sur `id` ; toute valeur IXELLIO ou corrigée à la main serait remplacée (et les champs absents mis à null) au prochain import.
6. **Flux IXELLIO réel** (`src/lib/ixellio.server.ts`) : pas une API JSON mais du scraping HTML authentifié : login + CSRF, puis `GET /ident.html?method=searchByImmatOnLocalBase&ajax=1` (base locale, utilisé si ≥3 champs reconnus), sinon `POST /ident.html?method=searchByImmat` + redirections. Le HTML est parsé par libellés (`src/lib/ixellio-parse.ts` l.205-235) : `puissanceCh` attend « Puissance ch / puissance réelle / DIN / ch / chevaux », et le contenu numérique est accepté.

## Hypothèses (non démontrées)

- **199 ch dans la réponse utilisée** : non vérifiable. Aucune réponse IXELLIO brute n'est conservée (ni log, ni `source_raw` pour ce véhicule), et je n'ai pas relancé d'appel pour protéger la session unique. Probable que l'écran « recherche assistée / carte grise » corresponde au `POST searchByImmat` ; la réponse courte `searchByImmatOnLocalBase` peut ne pas contenir la puissance et court-circuite pourtant le POST dès 3 champs trouvés : risque de fiche partielle.
- Le libellé IXELLIO peut être « Puissance Ch. » : normalisé « puissance ch », il correspondrait. « Version E-TECH 200… », « AUTOMATIQUE », « H5F B6 » seraient aussi lus s'ils sont sur la page parsée.
- La mise à jour du 07/11 08:42 n'est pas expliquée par IXELLIO (source inchangée) : probablement une édition ou un autre traitement ; non tracé.

## Correctifs proposés (en attente de votre feu vert)

1. **Prioritaire, minimal** : import WinMotor : traiter `0`/`0,0` comme absent pour `power_hp`/`power_kw` ; retirer « Puissance fiscale »/« Puissance CV » de `power_hp` (aller vers `fiscal_power`). Tests de mapping.
2. **Complétion IXELLIO** : considérer `"0"` comme vide pour les puissances dans `planFillEmpty` ; pour modèle/version/boîte/code moteur proposés différents, afficher « remplacer » au choix explicite de l'utilisateur (aucun écrasement automatique).
3. **Ne plus écraser au ré-import** : dans `ingest.ts`, ne pas remplacer les champs techniques d'une fiche dont `source_system` est IXELLIO/correction manuelle, et ne jamais envoyer de null sur un champ rempli.
4. **IXELLIO** : ne court-circuiter le POST complet que si la base locale contient la puissance/version ; conserver un extrait brut minimal (libellés reconnus/non reconnus, sans secrets) pour diagnostiquer ; vérifier ensuite sur un essai unique GY-640-HM que 199 ch est bien lu.

Aucune modification de code ni de donnée n'a été faite.
