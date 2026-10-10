# Cahier des charges technique — « DDA Assistant » (socle commun Messenger + voix)

Document uniquement : aucun code, aucune migration, aucune connexion, aucune publication. L'approbation de ce plan ne déclenche rien ; chaque étape demandera un feu vert séparé.

## Décisions définitives

Un seul projet, un seul socle : Messenger et voix partagent le même moteur métier, la même fiche client/véhicule, le même historique, les mêmes notifications DDA + e-mail.

Messenger (Castillon) :
1. Créneaux : lun-ven 8-12 / 14-18, 1 h, au moins 4 jours ouvrés à l'avance ; week-ends et jours fériés français exclus.
2. L'IA confirme directement le RDV, sans validation humaine : fiche RDV dans DDA Connect + e-mail détaillé immédiat uniquement à Delphine, Marc et Frédéric. Pas d'agenda ni de capacité atelier. Garde-fou : un créneau déjà réservé par l'IA n'est plus proposé.
3. Modification et annulation dans la conversation : même fiche + historique, nouveau récapitulatif client, nouvelle notification DDA + e-mail.
4. Question non résolue : fiche « Intervention nécessaire » + alerte e-mail, suivie jusqu'à résolution.
5. Offre : déterminée par le contexte de campagne Meta quand il est fourni, sinon question simple ; jamais déduite du seul texte du message.

Voix :
6. Appels reçus uniquement par renvoi du standard existant (Paritel / 2L à confirmer) ; l'IA ne décide jamais quand décrocher.
7. Scénario unique de messagerie évoluée, sans transfert. Le numéro appelé identifie le garage.
8. Étiquette informative selon l'heure Europe/Paris et le calendrier du site : lun-ven 08:00-12:00 et 14:00-18:00 hors fériés = « débordement » ; tout le reste (dont pause 12-14, nuit, week-end, férié) = « hors ouverture / appel de nuit ».
9. Reconnaissance de l'appelant prudente (voir §4).

## 1. Existant constaté

| Domaine | Constat | Où |
|---|---|---|
| Sites | `sites`, site actif global, droits par site | src/lib/sites.ts, src/lib/site-context.tsx, src/lib/user-functions.ts |
| Rôles / menus | `user_roles`, `user_module_access`, registre unique des modules | src/lib/access.ts, src/lib/module-access.tsx |
| Clients | `customers` (+ `site_id`, `source_system` winmotor), `customer_contacts` (type, value, `normalized_value` indexé), `customer_addresses`, `customer_vehicle_relations`, `customer_consents` ; ancien `clients` | migration 20260815181822 ; src/lib/refbase.ts |
| Véhicules | `vehicles`, `ref_vehicles`, kilométrages, `strictPlate` | src/lib/plate.ts, src/lib/vehicle-profile.ts |
| Agent WinMotor | Agent local par site (serveur « Chantal ») piloté par file `winmotor_agent_jobs` + RPC `winmotor_agent_status` / `winmotor_enqueue_job` ; commandes actuelles PING et GET_OR, lecture seule, asynchrone | src/lib/winmotor-agent.ts, src/routes/winmotor.tsx |
| Demandes | `crm_requests` + `crm_request_events` | src/lib/crm.ts |
| Notifications | Destinataires e-mail par site + journal | src/lib/tour-notify*.ts, src/lib/email.server.ts |
| Intégrations | `integration_credentials` chiffrées, Paramètres API | src/lib/crypto.server.ts, src/routes/parametrage.api.tsx |
| IA | Budget quotidien partagé, `runPaidAi`, `ai_usage_log` | src/lib/ai-usage.server.ts |
| Webhooks | Modèle `/api/public/*` vérifié | src/routes/api/public/ |
| Absent | Planning/RDV, Meta, téléphonie, normalisation E.164, configuration de campagnes | recherche src/ + migrations |

## 2. Réutilisable

Sites, droits (module `assistant`), `customers` / `customer_contacts.normalized_value` pour la recherche par téléphone, `vehicles` + `strictPlate`, `customer_consents`, destinataires + e-mail + journal, `integration_credentials`, `runPaidAi`, `dda-media`, file de l'agent WinMotor (nouvelle commande à ajouter côté agent), modèle webhook public.

## 3. Architecture commune

```text
Adaptateurs canal                 Socle DDA Assistant (commun)                    Sorties
Messenger webhook ─┐   ┌─ identité : contact canal -> client proposé (score) ─┐
  (ref / referral) │   │  contexte : campagne versionnée | étiquette horaire  │   fiche demande / RDV /
Voix webhook ──────┼─► │  moteur d'états unique + IA d'extraction             ├─► intervention / rappel
  (CLI, n° appelé) │   │  outils : slots, reserver, modifier, annuler,        │   notif DDA + e-mail site
Futur SMS / IG ────┘   │  escalader, rappel, rechercher_client                │   réponse canal
                       └─ réglages par site, calendrier fériés FR ────────────┘
                                   ▲
                 index contacts (copie minimale synchronisée depuis WinMotor)
```

Tables (toutes `site_id`, RLS par site) :
- `assistant_channels` (site, type messenger | voice | sms, identifiant externe : page id ou numéro appelé).
- `assistant_contacts` (identifiant canal : PSID ou E.164, numéro masqué, lien client proposé, score, provenance, statut vérifié/non).
- `assistant_conversations` (canal, contexte : campagne + version ou étiquette horaire, priorité, état) et `assistant_messages` (id externe unique).
- `assistant_calls` (id d'appel unique, CLI brut + E.164, numéro appelé, début/fin/durée, étiquette, issue, coût, interruption).
- `assistant_appointments` + `_events`, `assistant_interventions` + `_events` (intervention, rappel, urgence).
- `assistant_campaigns` (clé ref/ad id, version, offre, prix TTC, durée, période début/fin, conditions, site, actif) — saisie par paramétrage technique, pas d'écran créateur d'offres.
- `assistant_identity_links` (journal : contact, client candidat, source, score, décision, auteur ; jamais de fusion).
- `phone_index` (site, E.164, customer_id, source winmotor/dda, date de synchro).
- `assistant_settings`, `assistant_notification_recipients`, `assistant_notifications`.

Écran DDA minimal (module « Assistant ») : demandes et conversations (fiches RDV, interventions, rappels, appels), réglages (horaires, questions autorisées, destinataires, campagnes en lecture), connexions (Meta, téléphonie, IA). Aucun créateur d'offres.

## 4. Identité de l'appelant (voix)

1. CLI présenté si disponible, normalisé E.164 (+33…) ; numéro masqué = inconnu.
2. Recherche immédiate dans `phone_index` / `customer_contacts` du site appelé, latence plafonnée (ex. 300 ms) ; au-delà, accueil neutre sans attendre. WinMotor n'est jamais interrogé pendant l'appel.
3. Accueil personnalisé « Bonjour Monsieur/Madame [Nom] » uniquement si : une seule correspondance, source fiable, civilité connue, numéro mobile non partagé. Sinon formule neutre (plusieurs clients, fixe d'entreprise, masqué, incohérence, tiers possible).
4. Confirmation d'identité demandée dans tous les cas (« Je parle bien à … ? ») ; aucune donnée du dossier (véhicule, factures, RDV) énoncée avant confirmation, et même après seulement le strict nécessaire.
5. Chaque rattachement est journalisé (provenance, score, confirmé ou non) ; aucune fusion automatique.

Messenger : pas de CLI ; rattachement proposé à partir du nom + téléphone + plaque saisis, même règle de non-exposition.

### Index WinMotor via l'automate existant

Pas d'accès synchrone direct à WinMotor. Principe : nouvelle commande d'agent (ex. EXPORT_CONTACTS) exécutée périodiquement par l'automate du serveur Chantal, qui pousse une copie minimale par site (identifiant client WinMotor, nom, civilité, téléphones normalisés) dans `phone_index`, en complément des clients déjà importés dans DDA. Mise à jour incrémentale (nuit + éventuellement toutes les heures). Faisabilité réelle (export possible depuis WinMotor, charge, fréquence) à vérifier avec l'agent.

## 5. Contexte campagne (Messenger)

- Capter `ref` (lien m.me), `referral` (publicité Click-to-Messenger : ad_id, source, type) et paramètres de campagne quand Meta les fournit.
- Associer à `assistant_campaigns` par clé + version ; la version est figée sur la conversation et la fiche RDV.
- Pas de contexte : question simple (« Souhaitez-vous l'offre nettoyage intérieur/extérieur à 39 € ou autre chose ? »). Jamais de promo déduite du texte.
- Campagne expirée ou inactive : non proposée ; message poli + alternative active si existante.
- Plusieurs campagnes actives : celle du referral prime ; sinon choix proposé.
- Recontact ultérieur : la campagne d'origine est rappelée seulement si encore valide.

## 6. Phase voix — déroulé unique

Annonce « assistant virtuel du garage » + information RGPD courte (pas d'enregistrement audio) → identité (§4) → objet → collecte prudente (prénom, nom, téléphone confirmé, plaque relue) → réponses aux seules questions autorisées → priorité (urgence sécurité/remorquage : consignes sûres, 112 si danger, assistance du contrat, aucune promesse) → demande de rappel + résumé relu → fiche + notifications du site appelé (Castillon : Delphine, Marc, Frédéric ; Lalinde plus tard). Réservation par téléphone plus tard via les mêmes outils.

Exigences : idempotence par id d'appel ; coupure = fiche « appel interrompu », rappel du même numéro rattaché ; durée max et budget quotidien ; transcription/résumé texte seulement si autorisé.

## 7. Risques

- **Meta** : App Review `pages_messaging`, vérification entreprise, fenêtre 24 h, jeton de Page ; `referral` pas toujours fourni (dépend du type d'annonce).
- **Téléphonie** : renvoi Paritel / 2L vers Twilio/SIP et transmission du CLI d'origine et du numéro appelé non garantis ; latence voix ; reconnaissance plaques/noms.
- **Identité** : numéros partagés (famille, entreprise), numéros recyclés, index périmé → risque d'appeler quelqu'un par le mauvais nom ou de divulguer des données ; d'où seuil strict, confirmation et non-exposition.
- **WinMotor** : export via l'automate peut être impossible ou lent ; index incomplet = accueil neutre (dégradation sans blocage).
- **RGPD** : base légale de la copie des téléphones (intérêt légitime à documenter), minimisation, durée de conservation, information orale et Messenger, effacement, transfert IA.
- **Doublons** : id externe unique (message, appel) ; rattachements proposés, jamais fusionnés.
- **RDV** : confirmés sans humain ni capacité ; conflit possible avec RDV pris hors IA (réserve explicite).
- **IA** : prix/offres/horaires tirés de la configuration versionnée, jamais générés.

## 8. Étapes et crédits Lovable (fourchettes indicatives)

Construction commune (socle + Messenger, voix préparée) :

| # | Étape | Crédits |
|---|---|---|
| 1 | Tables communes, RLS par site, module `assistant`, réglages Castillon | 10 – 18 |
| 2 | Calendrier (fériés FR, créneaux, étiquette horaire) + garde-fou doublon + tests | 5 – 10 |
| 3 | Moteur commun : réservation, modification, annulation, escalade, rappel + tests | 16 – 30 |
| 4 | Identité : E.164, `phone_index`, score, journal de rattachement + tests | 6 – 12 |
| 5 | Campagnes versionnées + captation ref/referral + tests | 5 – 10 |
| 6 | Webhook Meta (vérification, signature, idempotence) + envoi | 8 – 15 |
| 7 | Notifications DDA + e-mails (tous événements) | 5 – 9 |
| 8 | Écran minimal : demandes/conversations, réglages, connexions | 12 – 22 |
| 9 | Consentement, RGPD, purge / export | 4 – 8 |
| 10 | Recette Messenger réelle (mode test Meta) | 8 – 20 |
| | **Sous-total socle + Messenger** | **≈ 79 – 154** |

Voix (sur le même socle) :

| # | Étape | Crédits |
|---|---|---|
| V1 | Étude raccordement Paritel / 2L (CLI, numéro appelé) + opérateur | 2 – 5 |
| V2 | Adaptateur voix temps réel + webhook appel + idempotence | 15 – 30 |
| V3 | Script unique, accueil personnalisé conditionnel, urgence, rappel + tests | 10 – 20 |
| V4 | Coupure/reprise, limites durée/coût, fiches voix | 5 – 10 |
| V5 | Recette appels réels | 8 – 20 |
| | **Sous-total voix** | **≈ 40 – 85** |

Synchronisation WinMotor (dépend de l'agent, hors app si l'agent est un programme séparé) : commande EXPORT_CONTACTS côté DDA + import incrémental : 5 – 12 crédits ; travaux sur l'automate lui-même non chiffrables ici.

**Total indicatif : ≈ 124 – 251 crédits** (hausse liée à l'identité, aux campagnes et à la synchro ; le socle commun évite une double construction).

Coût d'exploitation (hors Lovable, à confirmer) : Messenger gratuit ; IA texte quelques centimes par conversation ; numéro voix 1–3 €/mois ; minutes 0,01–0,03 €/min ; voix IA temps réel 0,05–0,30 €/min (ex. 300 appels × 3 min ≈ 50–300 €/mois) ; coût éventuel de renvoi chez Paritel / 2L ; serveur de l'agent déjà existant.

## 9. Critères de recette communs

Socle :
- Même moteur et même fiche quel que soit le canal ; un événement = une fiche, une notification DDA, un e-mail aux seuls destinataires du site.
- Calendrier : aucun créneau week-end, férié (11/11, 25/12, lundi de Pâques) ou < 4 jours ouvrés ; étiquette voix : mardi 10:30 = débordement ; mardi 12:30, 19:00, samedi, 11/11 = hors ouverture.
- Message ou appel relivré : aucun doublon. Rattachements client toujours journalisés, jamais fusionnés.
- Un utilisateur Lalinde ne voit rien de Castillon.

Messenger :
- Referral d'une campagne active : offre, prix, durée, conditions de la bonne version ; version figée sur la fiche.
- Sans contexte : question simple, aucune promo supposée. Campagne expirée : non proposée.
- Deux campagnes actives : referral prioritaire, sinon choix.
- RDV confirmé, modifié, annulé, intervention : comportements des décisions 2 à 4.
- Aucune collecte avant consentement.

Voix :
- Un client unique fiable → « Bonjour Monsieur [Nom] » puis confirmation ; deux clients sur le numéro, numéro masqué, fixe partagé → accueil neutre.
- Aucune donnée de dossier énoncée avant confirmation d'identité.
- Index lent ou indisponible : décrochage sans attente, accueil neutre.
- Dialogue identique quel que soit l'horaire ; aucun transfert ; urgence sans promesse.
- Pas d'audio stocké par défaut ; coupure = fiche « appel interrompu » reprise au rappel.

## 10. À confirmer

1. Page Facebook Castillon, Business Manager vérifié, type d'annonces (Click-to-Messenger ou lien m.me) ; Instagram plus tard ?
2. Liste des campagnes actuelles (offre 39 € TTC, période, conditions) et qui les saisit.
3. IA via Lovable plutôt qu'une clé OpenAI propre ?
4. E-mails de Delphine, Marc, Frédéric ; numéro du garage pour les urgences.
5. Fermetures exceptionnelles ; décompte des 4 jours ouvrés ; délai limite de modification/annulation.
6. Téléphonie : Paritel ou 2L, renvoi vers numéro externe/SIP, transmission du CLI et du numéro appelé.
7. Agent WinMotor (serveur Chantal) : export des contacts possible ? Fréquence acceptable ?
8. Seuil d'accueil personnalisé : accepter le nom seul après correspondance unique, ou toujours neutre au départ ?
9. Base légale et durée de conservation de l'index téléphones, conversations, transcriptions ; texte RGPD.
10. Questions simples autorisées au téléphone ; transcription autorisée ou non ; durée max et budget voix.
11. Destinataires Lalinde (plus tard).
