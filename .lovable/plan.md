# Recette IA documentaire (banc de test A/B) — plan d'architecture

Plan d'analyse uniquement : aucun fichier, aucune migration et aucune publication tant que vous n'avez pas validé.

## 1. Ce que le code actuel permet déjà de réutiliser

- **Service IA central `runPaidAi`** (`src/lib/ai-usage.server.ts`) : il gère l'empreinte, le cache `ai_cache`, les budgets, l'appel unique sans nouvelle tentative et le journal `ai_usage_log` (fonction, modèle, tokens, durée, statut HTTP, cache, coût estimé, voie). Il ne renvoie pas encore au code appelant les tokens, la durée ni le statut HTTP : il les écrit seulement dans le journal.
- **Vision** (`src/lib/ocr.server.ts`) : `askVision` et `askVisionMulti` (image ou PDF en bloc `file`, plusieurs images). Le modèle est figé dans la constante `VISION_MODEL = "google/gemini-3.5-flash"`.
- **Pipeline réel** : `runDocPipeline` (pur, avec ses fonctions injectées) et `readDocument` (serveur). Ensemble, ils couvrent l'OCR/les règles, puis l'IA texte, puis la vision. `readDocument` n'écrit que des journaux IA et lit `suppliers` et `supplier_doc_profiles`. L'apprentissage fournisseur (`learnSupplierProfile`) est appelé à part dans `ocr.functions.ts` : il suffit de ne pas l'appeler.
- **Règles par type** : `DOC_SPECS` / `DocKind` dans `doc-rules.ts`, plus les invites existantes dans `ocr.functions.ts` (commande, BL, facture, OR, batterie, ticket, `ocrAnyDocument`).
- **Lecture locale** : `localDocText` (`doc-text.browser.ts`) lit le texte d'un PDF ou fait l'OCR Tesseract. `pdf-text.ts` fournit `extractPdfText` et `fileFingerprint` (SHA-256). `pdf-split.ts` découpe les PDF.
- **Entrée** : `DocDropZone` (glisser-déposer, fichier, photo, collage) ; `DOC_ACCEPT` accepte déjà HEIC/HEIF ; `photo.ts` et `photo-capture.ts` compressent les images.
- **Droits** : registre `MODULES` (`access.ts`), `ModuleGate`, `useModuleAccess`, et `isManager` dans `auth.tsx` (rôle `manager` dans `user_roles`).
- **Coûts** : `ai-costs.ts` (`summarize`) et la page `/parametrage/couts`, qui pourra filtrer la feature benchmark.
- **Stockage privé** : bucket `dda-media`, URL signées de 5 minutes (modèle `order-docs.ts`).

## 2. Architecture proposée (la plus simple et robuste)

```text
Navigateur (/parametrage/recette-ia, managers uniquement)
  DocDropZone (+ multi-photos)
  -> prétraitement UNIQUE : compression image / PDF tel quel, SHA-256, texte local (localDocText)
  -> upload privé dda-media/benchmark/<sha>.<ext>   (une seule fois)
  -> serveur : benchClassify   -> type + confiance
  -> serveur : benchRun(model A) | benchRun(model B) | benchPipeline   (en parallèle ou au choix)
  -> écran comparaison A / B / Pipeline + vérité terrain + scores
  -> sauvegarde dans une campagne (tables ai_bench_*)
```

Principes :
- **Même média pour A et B** : le serveur relit le fichier depuis le stockage privé à partir de son chemin et de son SHA. Les deux modèles reçoivent donc exactement les mêmes octets, avec la même invite et le même schéma.
- **Schéma de sortie unique et versionné** (`BENCH_SCHEMA_VERSION`) : bloc `document` (type, en-tête, identifiants, dates, OR, immatriculation, VIN, km), `lines[]`, `totals`, `tire`, `battery`, `workshop`. Chaque champ prend la forme `{ value, confidence }`, avec un tableau `failure_reasons`. Une règle « pneus » est intégrée : la profondeur reste `null` avec la mention « non mesurable avec fiabilité sur cette photo » sauf si une jauge est lisible.
- **Classification** : un appel léger à la vision (modèle A, invite courte) donne le type et sa confiance. Une pré-classification locale par mots-clés sur le texte (BL, Facture, Avoir, Commande, OR, SOH/CCA, TVA ticket) peut l'éviter quand elle est nette. Le type est modifiable à la main ; la relance réutilise le média déjà chargé.
- **Isolation totale** : nouveaux modules `bench-*`. Le benchmark n'écrit que dans `ai_bench_*`, `ai_usage_log` et le stockage `benchmark/`. Il n'appelle aucune fonction qui touche aux commandes, réceptions, OR, véhicules, fournisseurs ou profils fournisseurs.

## 3. Fichiers

**Existants à modifier (changements minimes, sans effet sur le métier)**
- `src/lib/ai-usage.server.ts` : options facultatives `bypassCache` et `fingerprintSalt` ; résultat enrichi (`tokensIn`, `tokensOut`, `durationMs`, `httpStatus`, `rawResponse`). Les appelants actuels restent inchangés.
- `src/lib/ocr.server.ts` : `askVision` / `askVisionMulti` acceptent un `model` facultatif (par défaut `VISION_MODEL`).
- `src/lib/doc-pipeline.server.ts` : `readDocument` accepte des options facultatives `bypassCache` et `model`. Il les transmet à `runPaidAi` et `askVision`.
- `src/lib/access.ts` : ajout d'une entrée pour la Recette IA, couverte par le droit `parametrage` existant ou par une clé dédiée (voir le point 9).
- `src/routes/parametrage.index.tsx` : une tuile « Recette IA ».
- `src/lib/ai-costs.ts` : libellé de la feature `ai_document_benchmark` (affichage uniquement).

**Nouveaux**
- `src/lib/bench-schema.ts` : schéma, types, invites versionnées et hash d'invite (pur).
- `src/lib/bench-score.ts` : comparaison, normalisation (montants, immatriculation, références, dates) et calcul des scores (pur).
- `src/lib/bench-classify.ts` : pré-classification locale par mots-clés (pur).
- `src/lib/bench-export.ts` : export JSON, texte lisible et anonymisation (pur).
- `src/lib/bench.server.ts` : contrôle manager, lecture du média, appels modèle et pipeline, persistance.
- `src/lib/bench.functions.ts` : `benchClassify`, `benchRun`, `benchPipeline`, `benchSaveTest`, `benchListCampaigns`, `benchCampaignExport`, `benchModels`.
- `src/routes/parametrage.recette-ia.tsx` : la page.
- `src/components/bench/` : `BenchInput`, `BenchCompare`, `BenchRawPanel`, `BenchTimings`, `BenchTruthForm`, `BenchScores`, `BenchCampaign`.
- `src/lib/__tests__/bench-score.test.ts`, `bench-classify.test.ts`, `bench-export.test.ts`, `ai-usage-bypass.test.ts`.

## 4. Migration SQL (une seule)

- `ai_bench_campaigns` (id, name, created_by, created_at, notes, model_a, model_b).
- `ai_bench_tests` (id, campaign_id, file_name, mime, sha256, storage_path, page_count, photo_count, detected_kind, kind_confidence, corrected_kind, expected jsonb, scores jsonb, app_commit, status draft/saved, created_by, created_at).
- `ai_bench_runs` (id, test_id, variant A/B/pipeline, model, prompt_version, prompt_hash, prompt_text, schema_version, started_at, upload_ms, preprocess_ms, ai_ms, total_ms, tokens_in, tokens_out, credits, http_status, success, cache_hit, failure_reason, parsed jsonb, raw_text, route pour le pipeline, usage_log_id).
- Ajout de `ai_usage_log.bench_run_id uuid null`, facultatif, pour relier le coût exact.
- `ai_bench_settings` (une ligne) : `candidate_model`, `max_credits_per_test`.
- RLS : lecture et écriture réservées aux managers. Le mécanisme de vérification de rôle côté base (fonction `has_role` ou équivalent) sera vérifié avant la migration. GRANT au rôle `authenticated`. Aucune modification des tables métier.
- Stockage : préfixe `dda-media/benchmark/` lisible seulement par les managers (politique dédiée), URL signées de 5 minutes.

## 5. Cache benchmark

- Le cache normal n'est pas touché : sa clé reste `feature + modèle + graine`.
- Le benchmark utilise la feature `ai_document_benchmark` (invisible pour le métier) avec `bypassCache: true` par défaut : aucune lecture ni écriture dans `ai_cache`, et chaque lancement est un appel réel journalisé `cache_hit=false`.
- Option « Réutiliser le cache du benchmark » : la graine devient `sha256 + modèle + prompt_hash + schema_version`. Elle ne peut jamais entrer en collision avec les caches métier.
- Pipeline réel : il est lancé en `bypassCache` pour mesurer un vrai coût. Une option permet de le lancer avec le cache, pour reproduire exactement le comportement en production.

## 6. Choix du modèle B

- Liste proposée côté serveur par `benchModels`, à partir du catalogue de la passerelle (`/v1/models`) filtré sur l'entrée image. La liste est mise en cache 1 heure ; en cas d'échec, une liste statique connue est utilisée.
- Le modèle B est mémorisé dans `ai_bench_settings.candidate_model` et modifiable à chaque test. Le modèle A est lu depuis `VISION_MODEL`, ce qui suit automatiquement un futur changement.
- Le serveur vérifie que l'identifiant fait partie de la liste autorisée avant l'appel. Aucune clé ne passe par le navigateur.
- Point technique : la passerelle utilise aujourd'hui `/v1/chat/completions`. Les modèles `openai/*` récents exigent `/v1/responses` et des réglages de raisonnement, et les modèles `anthropic/*` passent par `/v1/messages`. Proposition V1 : B limité aux modèles compatibles avec chat-completions et vision (famille Gemini, plus OpenAI s'il est accepté sur cet accès). Ajout d'un adaptateur Responses en V2 si nécessaire (voir le point 9).

## 7. Mesure des temps

- **Upload** : chronométré dans le navigateur (`performance.now()` autour de l'envoi), une fois par test et commun à A et B.
- **Prétraitement** : navigateur (compression, SHA, texte local) et serveur (lecture du stockage, conversion en base64), mesurés séparément.
- **Temps IA** : mesuré dans `runPaidAi` entre l'envoi de la requête et la réception complète de la réponse, puis renvoyé et journalisé.
- **Lecture du JSON** : mesurée à part sur le serveur.
- **Temps total** : du clic jusqu'au résultat affiché, côté navigateur.
- Tous les temps sont affichés par lancement avec le modèle, l'heure, les tokens, les crédits, le statut HTTP, le cache et le motif d'échec.

## 8. « Pipeline réel DDA » sans effet de bord

- `benchPipeline` appelle `readDocument` exactement comme en production. Il utilise le type corrigé ou détecté (purchase, OR, batterie…), le texte local, le média et l'invite métier réelle, avec la feature `ai_document_benchmark:pipeline`.
- Il n'appelle jamais `learnSupplierProfile`, ni aucune fonction de création ou de mise à jour (`ensure_winmotor_dossier_full`, commandes, réceptions…). Il ne fait que des lectures de référence (`suppliers`, `supplier_doc_profiles`).
- Résultat stocké : champs, voie (`ocr_rules`, `ai_text_fallback`, `ai_vision_fallback` ou `manual`), nombre d'appels IA et champs manquants. Il est converti vers le schéma benchmark par un adaptateur pur, pour être comparable.
- Le réglage « repli IA » et les budgets s'appliquent comme en production : c'est la qualité réellement livrée.
- Test garde-fou : un test vérifie que `bench.server.ts` n'importe aucun module métier qui écrit en base.

## 9. Risques et points à trancher

1. **Accès** : faut-il réserver la page au rôle `manager` uniquement (proposé), ou aussi à une clé de module dédiée `recette_ia` ?
2. **Budget** : faut-il compter les appels benchmark dans le budget journalier et mensuel global, au risque de bloquer le métier ? Proposition : compter les coûts, mais appliquer un plafond propre au benchmark et ne pas bloquer le métier sur ces coûts (exclusion de la feature dans `spentSince`).
3. **Modèle B hors chat-completions** (`openai/*` sur Responses, `anthropic/*` sur Messages) : faut-il un adaptateur dès la V1 ?
4. **HEIC** : la compression navigateur peut échouer selon le navigateur. Proposition : convertir en JPEG côté navigateur quand c'est possible, sinon refuser avec un message clair.
5. **PDF multi-pages** : envoi du PDF entier aux deux modèles (bloc `file`). Les PDF très lourds dépassent les limites ; plafond proposé : 20 pages ou 15 Mo.
6. **Multi-photos** : jusqu'à 5 photos par test, envoyées ensemble via `askVisionMulti`.
7. **Commit applicatif** : une variable de build injectée (`VITE_APP_COMMIT`) n'est pas garantie sur l'hébergement. À défaut : version d'invite, version de schéma et date.
8. **Données personnelles** : anonymisation simple à l'export (noms, téléphones, e-mails, VIN tronqué, immatriculation masquée). Durée de conservation des fichiers `benchmark/` à décider (proposé : 90 jours).
9. **Coût** : chaque test coûte environ 2 à 3 appels vision payants, plus la classification.

## 10. Complexité et étapes

Complexité moyenne : environ 7 étapes.
1. Service IA : contournement du cache, choix du modèle, métriques renvoyées, plus les tests.
2. Migration (tables `ai_bench_*`, RLS manager, colonne de liaison, politique de stockage).
3. Schéma, invites versionnées, classification locale, plus les tests.
4. Fonctions serveur `bench*` (contrôle manager, lecture du média, A/B/pipeline, persistance).
5. Page : entrée, classification, correction, lancements A/B/pipeline, temps, réponses brutes.
6. Vérité terrain et scores (deux champs vides jamais comptés comme succès), plus les tests.
7. Campagnes, historique, exports (JSON, texte, anonymisation), bouton « Nouveau test » avec avertissement, vérification de bout en bout, sans publication.

## Détails techniques complémentaires

- Score : champ correct seulement si la valeur attendue est non vide et que la valeur normalisée est égale. Faux si les deux sont présentes et différentes. Manquant si l'attendu existe et le modèle ne donne rien. Une valeur inventée alors que l'attendu est vide compte comme faux. Les lignes sont appariées par référence exacte, puis par position. Sous-scores : références, OR/immatriculation, montants (tolérance de 0,01 €).
- Motifs d'échec normalisés : `illisible`, `champ_absent`, `ambiguite`, `timeout`, `json_invalide`, `classification_erronee`, `http_<code>`, `budget`.
- L'export contient : nom de fichier, SHA, chemin privé (jamais d'URL), type, modèles, version et hash d'invite, réponses brutes et analysées, différences, valeurs attendues, scores, temps, tokens, crédits, erreurs.
