# Audit technique — module « DDA Assistant » (V1 Messenger Castillon)

Audit seul : aucun code, aucune migration, aucune connexion, aucune publication. Approuver ce plan ne lance rien ; chaque étape ci-dessous demandera un feu vert séparé.

## 1. Existant constaté

| Domaine | Constat | Où |
|---|---|---|
| Sites | Table `sites` (Castillon / DDA-Lalinde), site actif global, droits par site (`fetchUserSites`, `site_scope`) | src/lib/sites.ts, src/lib/site-context.tsx, src/lib/user-functions.ts |
| Rôles / menus | `user_roles` (manager/salarie/client), `user_module_access` ; registre de modules unique → menu + contrôle d'URL | src/lib/access.ts, src/lib/module-access.tsx, src/components/ModuleGate.tsx |
| Clients | Deux modèles : `clients` (ancien) et `customers` + `customer_addresses`, `customer_contacts`, `customer_vehicle_relations`, `customer_consents` (par canal, source WinMotor) | migrations 20260815133359, 20260815181822 ; src/lib/refbase.ts, src/lib/queries.ts |
| Véhicules | `vehicles`, `ref_vehicles`, `mileage_history` / `vehicle_mileage_history`, normalisation plaque `strictPlate` | src/lib/plate.ts, src/lib/vehicle-profile.ts |
| Demandes | `crm_requests` (site_id, canal, sujet, nom/tél/e-mail, plaque, priorité, statut) + `crm_request_events` | src/lib/crm.ts, src/routes/crm.index.tsx |
| Notifications | Destinataires e-mail par site (`tour_notification_recipients`) + journal `tour_notifications` ; envoi e-mail serveur | src/lib/tour-notify*.ts, src/lib/email.server.ts, src/routes/parametrage.notifications.tsx |
| Intégrations | `integration_credentials` chiffrées (src/lib/crypto.server.ts), page Paramètres API, état des connexions | src/routes/parametrage.api.tsx, src/lib/integration-status.ts |
| IA | Passerelle IA + budget quotidien partagé, journal `ai_usage_log`, `runPaidAi` | src/lib/ai-usage.server.ts, src/lib/ai-budget-day.ts |
| Fichiers | Bucket privé `dda-media`, URL signées 5 min, `media` | src/lib/photo.ts, src/lib/order-docs.ts |
| Webhooks publics | Modèle existant `/api/public/*` (ingestion e-mails, callback Gmail, hook gmail-sync) | src/routes/api/public/ |
| Modèles de messages | `message_templates` | src/routes/parametrage.messages.tsx |
| Absent | Aucun module planning/RDV, aucune intégration Meta, Twilio, OpenAI ni téléphonie dans le code | recherche sur tout src/ et les migrations |

## 2. Réutilisable

- Sites, droits, registre de modules (ajouter une clé `assistant`).
- `customers` / `vehicles` / `strictPlate` pour rattacher le prospect, **sans écrire directement** dans le référentiel WinMotor (proposition seulement, comme `dms_update_proposals`).
- `customer_consents` (modèle par canal) — à étendre avec `source='MESSENGER'`, horodatage, version du texte.
- `crm_requests` comme fil « demande » visible des équipes, ou au moins comme modèle.
- Destinataires par site + envoi e-mail + journal (copier le modèle des notifications Tour).
- `integration_credentials` chiffrées + page Paramètres API (jetons Meta, Twilio).
- `runPaidAi` + budget IA + journal (coût maîtrisé de l'assistant).
- `dda-media` + URL signées pour les photos facultatives.
- Modèle webhook `/api/public/*` avec vérification de signature.

## 3. Architecture minimale recommandée

```text
Messenger (Page Castillon)
   -> /api/public/meta/webhook   (signature X-Hub-Signature-256, idempotence par message id)
   -> assistant_core (indépendant du canal)
        - machine d'états déterministe : offre -> créneau -> client -> véhicule -> consentement -> récap
        - IA seulement pour comprendre le texte libre / extraire les champs
        - outils métier : slots_disponibles(), trouver_client(), creer_demande_rdv()
   -> envoi réponse via Graph API Send
   -> notification e-mail Delphine / Marc / Frédéric (site Castillon)
Écran DDA « Assistant » : conversations, demandes RDV, statut, réglages
```

Nouvelles tables (V1) : `assistant_channels` (site, canal, page id), `assistant_contacts` (identifiant canal PSID, lien customer facultatif), `assistant_conversations`, `assistant_messages` (id externe unique), `assistant_appointments` (dossier RDV : site, offre, date/heure, statut demandé/confirmé/annulé, données client et véhicule saisies), `assistant_settings` (horaires, délai 4 jours ouvrés, offre 39 € TTC 1 h, texte des règles), `assistant_notification_recipients`. Toutes avec `site_id` et RLS par site.

Règles de créneaux en logique pure testée (lun-ven 8-12 / 14-18, 1 h, J+4 ouvrés minimum, fériés à confirmer). Demande urgente → message « appelez le garage » + numéro.

Futur vocal : même `assistant_core` et mêmes outils ; ajout d'un adaptateur canal (Twilio Voice / SMS ou OpenAI Realtime) et d'un webhook dédié. Rien de vocal en V1.

## 4. Risques

- **Meta** : app Meta + vérification entreprise + revue App Review (`pages_messaging`) ; fenêtre de 24 h pour répondre (hors balises de message) ; jeton de Page longue durée à renouveler ; Instagram = compte pro lié, autre revue.
- **Sécurité** : webhook public → vérifier la signature, ne rien renvoyer de privé ; jetons chiffrés côté serveur ; pas de données d'autres clients exposées au chat (l'assistant ne doit jamais confirmer « vous êtes déjà client chez nous avec tel véhicule »).
- **RGPD** : consentement explicite avant collecte, mention d'information, durée de conservation, droit d'effacement ; transfert de données vers le fournisseur IA à mentionner ; photos = données personnelles (plaques, visages).
- **Doublons** : Meta peut relivrer un message → unicité sur l'id externe ; un même client par plusieurs canaux → lien customer proposé, jamais fusion automatique.
- **Garanties RDV (réserve explicite)** : pas d'agenda réel, pas de contrôle de capacité atelier ; deux clients peuvent obtenir le même créneau. V1 = « demande de RDV », confirmée par un humain. Option légère : refuser un créneau déjà demandé (contrainte unique site + créneau), sans gérer la capacité réelle.
- **IA** : hallucination prix/horaires → prix et règles injectés depuis les réglages, jamais générés ; budget quotidien partagé avec le reste de DDA.

## 5. Étapes et estimation de crédits Lovable (fourchettes indicatives)

| # | Étape | Crédits |
|---|---|---|
| 1 | Tables, RLS par site, module `assistant`, réglages Castillon | 8 – 15 |
| 2 | Règles de créneaux pures + tests | 4 – 8 |
| 3 | Moteur de conversation déterministe + extraction IA + tests | 12 – 25 |
| 4 | Webhook Meta (vérif, signature, idempotence) + envoi Graph API | 8 – 15 |
| 5 | Notifications e-mail Delphine / Marc / Frédéric | 3 – 6 |
| 6 | Écrans DDA : conversations, demandes RDV, réglages | 10 – 20 |
| 7 | Consentement, mentions RGPD, purge / export | 4 – 8 |
| 8 | Recette réelle Messenger (mode test Meta) et corrections | 8 – 20 |
| | **Total V1** | **≈ 57 – 117** |
| — | Futur vocal/SMS (adaptateur + webhook + tests) | 30 – 70 |

Coût d'exploitation (hors Lovable) : Messenger API gratuite ; IA via passerelle Lovable ≈ quelques centimes par conversation (budget plafonnable) ; hébergement/base inclus dans Lovable Cloud ; plus tard Twilio SMS ≈ 0,07–0,10 € par SMS FR, voix ≈ 0,01–0,03 €/min + numéro ≈ 1–3 €/mois, voix temps réel IA ≈ 0,05–0,30 €/min. Estimations à confirmer sur les grilles en vigueur.

## 6. À confirmer

1. Page Facebook Castillon : qui est admin, Business Manager vérifié ? Instagram inclus en V1 ou non ?
2. IA via la passerelle Lovable (pas de clé) plutôt qu'une clé OpenAI propre ?
3. Adresses e-mail de Delphine, Marc et Frédéric ; e-mail seul ou aussi alerte dans DDA ?
4. Le RDV reste « demande à confirmer » par le garage (recommandé) ou confirmé automatiquement ?
5. Bloquer un créneau déjà demandé ? Combien de nettoyages en parallèle ?
6. Jours fériés / fermetures exclus ? « 4 jours ouvrés » compté à partir de quand ?
7. Rattacher au client WinMotor existant, ou garder les prospects séparés jusqu'à validation ?
8. Durée de conservation des conversations et photos ; texte RGPD fourni par vous ?
9. Numéro de téléphone du garage à donner pour l'urgence.
10. Créer une demande dans le CRM existant en plus du dossier RDV ?
