# DDA Pneus V10 — contrat API (site public ↔ DDA Connect)

État : **développé et testé, INACTIF**. Rien n'est publié, aucune migration V10 appliquée,
aucun secret ni planificateur configuré. L'API `POST /api/public/tyres/quotes` existante est inchangée.

Base : `https://<domaine DDA Connect>/api/public/tyres/…`. Toutes les routes : `Origin` exactement
dans la liste autorisée (Paramètres > Devis pneus — Site web), `Content-Type: application/json`
pour les POST. Erreurs : `{ "error": { "code", "message" }, "fields"?: string[] }`.

## Conditions d'activation (toutes requises)
1. Appliquer `docs/migrations-pending/V10_tyres_commercial_traffic.sql` (après validation).
2. Créer le bucket **privé** `tyre-commercial-quotes`.
3. Variables serveur : `TYRES_V10_ENABLED=true` ; `TYRES_V10_VERIFIED_SENDER_DOMAINS` (ex. `garagecastillon.fr,dda-lalinde.fr`, seulement les domaines réellement vérifiés chez le fournisseur d'e-mail) ; facultatif `GOOGLE_IDENTITY_CLIENT_ID` ; pour le rapport `TYRES_REPORT_SECRET` (≥ 32 caractères).
4. Devis web déjà activé (`tire_web_quote_settings.enabled`).
5. Publication sur instruction.
Sinon : 503 `service_unavailable` (aucune écriture, aucun e-mail).

## GET /public-config
200 (même désactivé, sans secret) :
```json
{ "version": "v10", "enabled": false, "quotesEnabled": true,
  "sites": [{ "key": "castillon", "label": "Garage Castillon (Castels et Bézenac)" }, { "key": "lalinde", "label": "Damien Digoin Automobile (Lalinde)" }],
  "commercial": { "validityDays": 7, "phoneRequired": true, "emailRequired": true, "consentRequired": true },
  "analytics": { "consentRequiredForIdentifiers": true, "maxBatch": 25 },
  "google": { "enabled": false, "clientId": null } }
```
Si Google configuré : `"google": { "enabled": true, "clientId": "…apps.googleusercontent.com", "scopes": ["openid","email","profile"] }`.

## POST /commercial-preview → `application/pdf`
Corps strict : `{ quoteId: uuid, tier: "entree"|"milieu"|"haut", season: "ete"|"quatre_saisons", site: "castillon"|"lalinde", name, email, phone }`.
PDF marqué « APERÇU — NON ENVOYÉ », lu depuis le devis conservé (non expiré, 15 min). Rien n'est enregistré ni envoyé.
Codes : 200, 400, 403, 409 `quote_expired`, 413, 415, 422 `offer_unavailable`, 429 (20/h/IP), 503.

## POST /commercial-requests
Corps strict :
```json
{ "requestId": "uuid v4 généré par le site (même valeur à chaque réessai)",
  "quoteId": "uuid", "tier": "milieu", "season": "ete", "site": "castillon",
  "name": "Jean Dupont", "email": "jean@example.fr", "phone": "06 12 34 56 78",
  "message": "facultatif ≤ 500", "consent": true, "googleIdToken": "facultatif" }
```
Aucun créneau, aucun paiement. Ordre serveur :
1. `requestId` déjà connu → réponse **rejouée** (en-tête `Idempotent-Replay: true`) ; contenu différent → 409 `idempotency_conflict` ; encore en cours → 409 `request_in_progress`.
2. Quota 5/h/IP.
3. Offre acceptée relue dans le devis conservé.
4. Google facultatif : signature JWKS, `iss`, `aud` = client ID, `exp`, `email_verified` ; seuls nom/e-mail ; aucun droit staff. Invalide → 401 `google_invalid`.
5. **Revalidation fraîche** via le moteur existant (sans cache 5 min) : même marque, modèle, dimension, indices, quantité, prix. Différence →
```json
409 { "error": { "code": "offer_changed", "message": "…" }, "changed": ["totalTtcCents"],
      "quoteId": "nouveau devis", "expiresAt": "…", "offer": { …case WebQuoteCase… } | null }
```
Le site affiche la nouvelle offre et renvoie une demande avec le **nouveau quoteId et un nouveau requestId** après nouvelle acceptation. Sources indisponibles → 503 `revalidation_unavailable`. Aucun enregistrement ni e-mail dans ces cas.
6. Enregistrement atomique (UNIQUE `request_id`) du prospect rattaché au garage, statut `nouveau`.
7. PDF serveur archivé en privé, puis e-mails client + accueil du garage avec le même PDF joint. Expéditeur : Castillon `contact@garagecastillon.fr`, Lalinde `contact@dda-lalinde.fr`, uniquement si le domaine est déclaré vérifié — **aucun repli**.

Réponse 201 :
```json
{ "requestId": "…", "reference": "DDA-PN-20261101-0B7C1D", "status": "recorded", "prospectStatus": "nouveau",
  "validUntil": "2026-11-08T13:00:00.000Z", "totalTtcCents": 41234,
  "delivery": { "overall": "delivered"|"partial"|"not_delivered",
                "client": "sent"|"failed"|"not_sent", "frontOffice": "sent"|"failed"|"not_configured"|"not_sent",
                "reason": null|"pdf_failed"|"sender_not_verified" },
  "message": "…" }
```
`status: recorded` signifie enregistré ; `delivery.overall = delivered` signifie seulement que les deux e-mails ont été **acceptés par le fournisseur d'envoi** — pas qu'ils sont arrivés en boîte de réception.
`delivery.frontOfficeRecipientMismatch: true` signale que `sites.contact_email` diffère de l'adresse validée (non utilisée).

Contrôle de charge : si l'indice de charge **connu** de l'offre (conservée ou fraîche) est inférieur à celui demandé (indice double : la plus faible valeur), 422 `offer_load_insufficient`, sans enregistrement ni e-mail (aussi sur `/commercial-preview`). Indice inconnu : réserve de compatibilité, pas de refus.

Destinataires Front Office **fixes et validés** : Castillon `contact@garagecastillon.fr`, Lalinde `contact@dda-lalinde.fr` (`FRONT_OFFICE_RECIPIENTS`, `src/lib/tire-v10.ts`). `sites.contact_email` n'est jamais utilisé à leur place.

États et reprise : enregistrement (`pending`) → marquage `sending` + `emails_attempted_at` **avant** tout e-mail (si ce marquage échoue : aucun envoi, `reason: "status_not_saved"`) → envoi (clés d'idempotence `tyres-v10-client-<requestId>` / `tyres-v10-fo-<requestId>`) → écriture finale (3 tentatives). Si l'écriture finale échoue, un rejeu du même `requestId` (ligne `sending`, ou sans réponse depuis > 10 min) renvoie **202** `{ status: "recorded", delivery: { overall: "unknown" } }` et **ne renvoie jamais** d'e-mail.
Reprise administrative sûre (manager, lecture du journal du fournisseur d'e-mail par `requestId`/clé) : mettre à jour la ligne `delivery_status`, `client_email_status`, `fo_email_status`, `response_status`, `response_body` d'après le constat réel ; aucun renvoi automatique. Un renvoi manuel éventuel doit réutiliser les mêmes clés d'idempotence.
Statuts prospect (CRM) : `nouveau`, `a_contacter`, `contacte`, `rdv_pris`, `vendu`, `perdu`.

## POST /events
```json
{ "consent": { "analytics": true },
  "events": [{ "eventId": "uuid", "type": "page_view"|"session_start"|"quote_generated"|"offer_selected",
    "occurredAt": "ISO facultatif", "visitorId": "[A-Za-z0-9_-]{16,64}", "sessionId": "idem",
    "page": "accueil"|"devis"|"demande"|"confirmation"|"mentions"|"autre",
    "device": "mobile"|"tablet"|"desktop"|"other",
    "utmSource": "…", "utmMedium": "…", "utmCampaign": "…",
    "width": 205, "ratio": 55, "rim": 16, "quantity": 4, "tier": "milieu", "season": "ete", "site": "castillon" }] }
```
1 à 25 événements, champs inconnus refusés (aucune URL, coordonnée, e-mail…). Sans consentement, `visitorId`/`sessionId` sont supprimés côté serveur : l'événement reste compté anonymement (n'envoyez pas d'identifiant avant consentement). UTM réduits à `[a-z0-9_.-]{1,40}`. `request_submitted` est produit **uniquement** par le serveur. Heure/jour calculés en Europe/Paris. Quota 120/10 min/IP.
Réponse 202 `{ "accepted": n, "inserted": n, "duplicates": n }` (dédoublonnage par `eventId`).

## POST /daily-report (planificateur, NON activé)
`Authorization: Bearer <TYRES_REPORT_SECRET>`. Peut être appelé chaque heure : n'agit qu'à 07 h Europe/Paris (changements d'heure gérés, veille de 23 h ou 25 h). Idempotent par date (table + clé d'envoi). Destinataire unique `damien@garagecastillon.fr`. Contenu : trafic agrégé, nouvelles demandes, prospects à traiter, comparatif Castillon/Lalinde, couverture du consentement. Réponses : 200 `{skipped:"not_7am_paris"|"already_done"}` ou `{reportDate, sent}`, 401, 502, 503.
Planification (à NE créer qu'après validation) : **`0 * * * *` UTC** ; la garde serveur n'agit qu'à l'heure 07 Europe/Paris (06:00 UTC l'hiver, 05:00 UTC l'été).
Reprise : la date est prise atomiquement (`tyre_daily_reports`). `sent` ou `running` récent → `already_done`. `failed` (échec confirmé) → réessai à l'appel suivant avec une **nouvelle** clé d'envoi (`…-r<n>`). `running` abandonné (> 30 min, issue inconnue) → réessai avec la **même** clé, pour que le fournisseur d'e-mail dédoublonne. `?force=1` (même secret) permet une relance manuelle hors 7 h.
Si le volume dépasse le plafond de lecture (50 000 lignes, pagination par 1 000), le rapport le signale explicitement.

## Tableau de bord managers
Paramètres > Chiffrage : bloc « Trafic du site pneus » (RLS managers ; affiche « non encore activé » tant que la migration manque). PDF archivés lisibles uniquement par les managers du garage via URL signée.

## Logos
Disponible : logo DDA/Renault du projet. **Manquant : logo Dacia officiel** — non inventé ; à fournir pour l'ajouter.

## Photo de pneu (OCR navigateur côté Sites)
Réutilisable tel quel : `src/lib/tire-ocr-parse.ts` (pur, sans dépendance). Entrée : texte OCR brut (ex. tesseract.js). Fonctions : `parseTireText(text) → { size, load, speed, season, ms, pmsf, brand, model, … }`, `parseSize`, `parseIndices`, `parseSeason`. Mappage vers `/quotes` : `size "205/55R16"` → `width/ratio/rim`, `load` → `loadIndex`, `speed` → `speedIndex`. Toujours faire confirmer par l'utilisateur.

## Compatibilité 3PMSF / indices — à traiter séparément
- Le moteur n'est pas modifié : charge et vitesse sont des minima ; la dérogation d'un cran de vitesse en 4 saisons 3PMSF reste la règle maison existante, toujours signalée `to_confirm` avec message.
- Le devis expose uniquement la preuve disponible (`compatibility`, `compatibilityMessage`) ; aucune mention « compatible » définitive : véhicule non vérifié.
- Correctifs nécessaires (non faits) : la présence réelle du marquage 3PMSF n'est pas toujours fournie par les sources ; il faudrait l'exiger de la source et sinon refuser la dérogation ; vérifier le fondement réglementaire de la dérogation ; saisir les indices d'origine du véhicule (carte grise/plaque) pour lever la réserve.

## Limites connues
- Réessai d'envoi après échec : le même `requestId` rejoue la réponse sans renvoyer ; aucun bouton de renvoi manager n'existe encore (reprise administrative décrite ci-dessus).
- Le domaine `dda-lalinde.fr` n'est pas vérifié à ce jour : Lalinde restera `sender_not_verified` sans e-mail tant qu'il ne l'est pas.
- Logo récupéré par l’URL de l’application ; s’il échoue, le PDF garde l’identité texte « Damien DIGOIN Automobile / LE SENS DU SERVICE » (jamais de PDF sans identité). Mots longs coupés, pagination automatique au-dessus du pied/aperçu.
- **Logos Renault et Dacia officiels : intégrés (01/11/2026).** PNG transparents (encre noire) issus des en-têtes renault.fr / dacia.fr, rasterisés via resvg sans retouche : Renault 120×156 px, 4 705 o, sha256 `7c3243…8b3343` ; Dacia 240×27 px, 1 384 o, sha256 `6f42a3…600fad0`. Embarqués en base64 dans `src/lib/brand-logos.ts` (chargement local `officialBrandLogos()`, contrôle `isCompletePng`, empreintes vérifiées par test), intégrés par `embedPng` dans l'en-tête blanc de `buildCommercialPdf` (`src/lib/tire-commercial-pdf.ts`). Le logo DDA/Renault distant ne sert plus que de repli si les logos locaux étaient invalides.
- En-tête PDF sur fond **blanc**, texte noir : « Devis pneumatiques — DDA Care », « Damien DIGOIN Automobile », « LE SENS DU SERVICE » toujours imprimés.
- Coordonnées garage dans le PDF : e-mail validé fixe (`FRONT_OFFICE_RECIPIENTS`). Adresse et téléphone repris de la fiche garage (`sites.address`, `sites.phone`) **uniquement s'ils sont renseignés** ; au 01/11/2026 ils sont vides pour Castillon et Lalinde, donc non imprimés.
- Générateur PDF : `src/lib/tire-commercial-pdf.ts` (`buildCommercialPdf(data, logo)`, lignes texte testables via `commercialPdfLines`), appelé par `handleCommercialPreview` / `handleCommercialRequest` dans `src/lib/tire-v10.server.ts`.
- Statistiques : couverture = part des **événements reçus** avec consentement, pas une proportion des visiteurs totaux.

## V10.1 — Champs facultatifs pour le frontend Sites (analytics consenti)
Tous **facultatifs** ; les omettre ne bloque rien (configurateur, devis, demande). Aucune coordonnée (nom, e-mail, téléphone, adresse, URL) n'est jamais acceptée dans `/events` : champ inconnu => 400.

### `/events` — champ ajouté par événement
- `quoteId` (uuid) : `quoteId` renvoyé par `POST /quotes`. À envoyer sur `quote_generated` et `offer_selected` (avec `tier`, `season`).
  Le serveur relit le **devis conservé** (jamais le moteur de prix ; lecture bornée à 1,5 s, échec ignoré) : taille et quantité viennent du devis serveur, la marque de l'offre choisie (tier+saison) aussi (`offer_verified=true`). Les `width/ratio/rim` client sont alors remplacés. Sans devis lisible : dimensions client gardées, `offer_verified=false`, exclues des statistiques de marques.
- `visitorId` / `sessionId` : seulement si `consent.analytics = true` (sinon supprimés côté serveur, déjà en place).

Exemple :
```json
{ "consent": { "analytics": true },
  "events": [{ "eventId": "uuid", "type": "offer_selected", "visitorId": "v_0123456789abcdef", "sessionId": "s_0123456789abcdef",
               "quoteId": "uuid du devis", "tier": "milieu", "season": "ete", "site": "castillon" }] }
```

### `/commercial-requests` — champ ajouté
```json
"analytics": { "consent": true, "visitorId": "v_0123456789abcdef", "sessionId": "s_0123456789abcdef" }
```
À envoyer **uniquement** si le visiteur a consenti à la mesure ; sinon omettre l'objet (`consent:false` => 400). `sessionId` facultatif. N'entre pas dans l'empreinte d'idempotence. L'événement serveur `request_submitted` porte alors `visitor_id`, `session_id`, `quote_id` et la marque de l'offre acceptée ; sans ce champ il reste anonyme (compté dans les demandes globales, hors cohorte).

### Calculs du tableau de bord (DDA Connect, managers)
- Série par **date Paris** sur 7 jours : pages vues, devis, demandes **enregistrées**, demandes avec **e-mails acceptés par le service d'envoi** (distinct ; pas une preuve de réception en boîte).
- Demandes globales (tous visiteurs) affichées à part, par garage.
- Taux visite→devis, devis→demande, visite→demande : **cohorte consentie uniquement** (visiteurs pseudonymes distincts). Dénominateur nul => « Non calculable ».
- Choix sans demande : dédupliqués **par devis** (`quoteId`) ; plusieurs choix sur le même devis = un seul. Si un `offer_selected` consenti n'a pas de `quoteId` => « Non calculable ».
- Marques choisies : seulement offres relues côté serveur.
- Lecture analytique 100 % découplée du moteur de prix ; pagination 1 000 lignes, plafond signalé.

### CRM prospects (écran Paramètres > Chiffrage & pneumatiques)
Liste (sites accessibles, RLS manager+site), filtre garage, contact (tél/e-mail cliquables), référence, date Paris, offre, total, état d'envoi, statut modifiable, PDF privé par URL signée 5 min.
Changement de statut **uniquement** par la RPC `set_tyre_prospect_status(_request uuid, _status text)` (manager + `user_can_access_site`, verrou de ligne, horodatage/auteur) ; l'UPDATE direct est retiré (la migration V10.1 révoque `UPDATE` et supprime la politique). Voir `docs/migrations-pending/V10_tyres_commercial_traffic.sql` §6–7 (non appliqué).

### Droits sur les prospects (migration préparée)
`authenticated` : **SELECT uniquement** (RLS manager + site). Aucun UPDATE/INSERT/DELETE direct : total, offre, consentement, empreinte, `request_id`, états d'envoi restent écrits par le serveur (`service_role`). Le statut CRM change seulement par `set_tyre_prospect_status`, qui ne touche que `prospect_status`, `status_changed_at`, `status_changed_by`. Contrat vérifié par `src/lib/__tests__/tire-v10-migration-contract.test.ts`.
Le contexte `analytics` n'entre pas dans l'empreinte d'idempotence : un réessai avec ou sans ce contexte rejoue la même demande (pas de nouvel envoi, pas de nouvel événement) ; seule la tentative qui enregistre la demande peut relier un identifiant pseudonyme, et seulement si elle porte `analytics.consent = true`.
