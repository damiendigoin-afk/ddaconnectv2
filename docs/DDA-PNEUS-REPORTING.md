# DDA Pneus — reporting quotidien et journal technique (phase 1, non activé)

Indépendant de `TYRES_V10_ENABLED` (jamais activé ici) : pas de PDF, pas de CRM, pas de recalcul Top prix.
SQL d'installation (non appliqué) : `docs/migrations-pending/reporting-contact.sql`.
Code : `src/lib/tyre-reporting.ts` (règles pures), `src/lib/tyre-reporting.server.ts` (handlers),
routes `src/routes/api/public/tyres/events.ts` et `src/routes/api/public/tyres/reporting-daily.ts`,
journal branché dans `src/lib/tire-web-contact.server.ts`. Tests : `src/lib/__tests__/tyre-reporting.test.ts`.

## Interrupteurs (`tyre_rpt_settings`, ligne id = 1, tout à `false` par défaut)
- `contact_log_enabled` : journal technique des demandes (30 j).
- `events_enabled` : `/events` répond 202 au lieu de 503. La 1re activation fixe `instrumentation_started_at` (jamais réécrit).
- `report_enabled` : envoi du rapport quotidien.
- `retention_days` (7–365, défaut 30) ; `test_emails`, `test_email_domains`, `test_visitor_ids`.
Sans les tables (SQL non appliqué), `/events` répond 503 et contact-request fonctionne exactement comme avant.

## Contrat frontend (optionnel)

### `POST /api/public/tyres/events`
CORS = `allowed_origins` du devis web. `Content-Type: application/json`, ≤ 16 Ko, quota 120 lots / 10 min / IP.
```json
{ "consent": { "analytics": true },
  "events": [ { "eventId": "uuid", "type": "page_view|session_start|quote_generated|offer_selected",
    "occurredAt": "ISO-8601?", "visitorId": "[A-Za-z0-9_-]{16,64}?", "sessionId": "idem?",
    "page": "accueil|devis|demande|confirmation|mentions|autre?", "device": "mobile|tablet|desktop|other?",
    "utmSource": "?", "utmMedium": "?", "utmCampaign": "?", "width": 205, "ratio": 55, "rim": 16,
    "quantity": 1, "tier": "entree|milieu|haut?", "season": "ete|quatre_saisons?",
    "site": "castillon|lalinde?", "quoteId": "uuid?" } ] }
```
1 à 25 événements, champs inconnus refusés (400). Sans consentement (`analytics:false`), RIEN n'est enregistré (réponse 202 `ignored`) : n'envoyer qu'après opt-in. Marque/dimension relues dans le devis serveur (`quoteId`+gamme+saison).
Réponse 202 `{ accepted, inserted, duplicates }` (rejeu du même `eventId` = doublon ignoré).
Jamais de nom, e-mail, téléphone ni URL libre. UTM réduites à `[a-z0-9_.-]{1,40}`.

### `POST /api/public/tyres/contact-request` — champ facultatif ajouté
```json
"analytics": { "consent": true, "visitorId": "…", "sessionId": "…?" }
```
À n'envoyer que si le visiteur a accepté la mesure d'audience. Il n'entre ni dans l'e-mail ni dans la clé
d'idempotence (`tyres-contact-{requestId}`) : même requête avec ou sans ce champ = même envoi.
Réponses inchangées (`{requestId, status:"sent", garage}` seulement après acceptation fournisseur).

### Mention UI suggérée
« Votre demande est conservée 30 jours dans un journal technique pour son suivi, puis supprimée. »

## Tests techniques
Règle serveur unique : contact dont l'e-mail ou le domaine figure dans les réglages, ou dont le nom/message
commence par `[TEST]` ; événement dont `visitorId` est listé ou `utmSource = dda_test`.
Exclus de tous les chiffres et listés à part dans le rapport.

## Rapport
Destinataire unique `damien@garagecastillon.fr` (jamais les Front Office), journée Paris de la veille
(23 h / 25 h aux changements d'heure). HTML + CSV joint des demandes (cellules anti-formule).
Contenu : audience consentie, pages, sources/UTM, appareils, heures, dimensions/quantités des devis serveur,
offres dispo/indispo, sélections (marque relue de l'offre serveur, gamme, saison), entonnoir de la cohorte
consentie + abandons par `quoteId`, comparatif veille / moyenne 7 j (depuis compteurs, « Non disponible »
sinon), demandes par garage (acceptées / échecs / en cours) et détail de chaque demande. Aucun prix d'achat,
marge, IP ni secret. Distingue « Mesure non active », « Aucune donnée reçue » et 0.

## Planificateur (phase 2, après revue)
- `pg_cron` `dda-tyres-reporting-daily` à `0 * * * *` UTC → `POST /api/public/tyres/reporting-daily` `https://ddaconnectv2.lovable.app/api/public/tyres/reporting-daily`.
- Bearer = secret Vault `tyre_reporting_cron_token`, généré par le SQL, lu par la tâche au moment de l'appel ;
  le serveur le vérifie via `tyre_rpt_verify_cron_token` (service_role uniquement).
- N'agit que de 7 h à 10 h Paris pour la seule veille ; `tyre_rpt_claim_report` garantit une émission par date.
  Le HTML/CSV/compteurs sont figés et persistés AVANT envoi (snapshot purgé après la rétention) ; tout nouvel essai réutilise ce snapshot (aucune relecture des demandes). Refus 4xx confirmé → nouvelle clé au créneau suivant (3 tentatives max) ; exception réseau ou 5xx = issue inconnue → ligne
  « running », reprise après 30 min avec la MÊME clé (dédupliquée par le fournisseur) ; snapshot absent = échec sans envoi. Aucun rattrapage d'autres dates.
- `dda-tyres-reporting-purge` quotidien : `tyre_rpt_purge(NULL)` supprime événements et journaux contact plus vieux
  que `retention_days` ; compteurs anonymes et historique d'émission conservés.

## Limites
- Aucune donnée antérieure à l'activation n'est reconstruite.
- Si le journal est indisponible au moment d'une demande, l'e-mail part quand même mais la demande
  manque dans le rapport (journal « best effort », jamais bloquant).
- Une demande dont l'issue d'envoi est inconnue apparaît « En cours / inconnu ».
- Le fournisseur d'e-mail ne déduplique une clé que pendant une durée limitée (24 h).
- Le rapport est plafonné à 50 000 lignes par source ; au-delà, un avertissement « tronqué » apparaît.
- Les routes `/events` V10 (`handleEvents`) restent dans le code mais la route publique utilise désormais le reporting.
- Devis : « calculs serveur distincts » ≠ consultations (un quoteId est partagé 5 min via le cache). Sélections dédupliquées par visiteur+devis+gamme+saison, abandons par visiteur+devis. Un devis n'est exclu que s'il n'est utilisé que par des tests ; les devis partagés test/réel sont comptés et signalés « attribution ambiguë ».
- Mesure inactive : les compteurs d'audience ne sont pas enregistrés (pas de faux 0 dans l'historique).
