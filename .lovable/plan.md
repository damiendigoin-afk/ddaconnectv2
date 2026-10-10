# Cahier des charges technique — « DDA Assistant »

Document uniquement : aucun code, aucune migration, aucune connexion, aucune publication. L'approbation de ce plan ne déclenche rien ; chaque phase demandera un feu vert séparé.

## Décisions définitives

V1 Messenger Castillon :
1. Créneaux : lun-ven 8-12 / 14-18, durée 1 h, au moins 4 jours ouvrés à l'avance ; week-ends et jours fériés français exclus (calcul déterministe, fériés mobiles inclus).
2. L'IA confirme directement le RDV, sans validation humaine : fiche RDV créée dans DDA Connect + e-mail détaillé immédiat, uniquement à Delphine, Marc et Frédéric. Pas d'agenda dédié ni de capacité atelier. Garde-fou léger : un créneau déjà réservé par l'IA n'est plus proposé (unicité site + créneau sur les seuls RDV IA actifs).
3. Modification et annulation dans la conversation : même fiche mise à jour avec historique, nouveau récapitulatif au client, nouvelle notification DDA + e-mail aux trois destinataires.
4. Question non résolue : fiche « Intervention nécessaire » dans DDA Connect + alerte e-mail aux trois destinataires, avec historique et suivi jusqu'à résolution.

Phase 2 (préparée dans l'architecture, non construite) : messagerie vocale évoluée, scénario unique, appels uniquement renvoyés par le standard, sans transfert, étiquette « débordement » ou « hors ouverture / appel de nuit » selon l'heure de Paris.

## 1. Existant constaté

| Domaine | Constat | Où |
|---|---|---|
| Sites | `sites` (Castillon, DDA-Lalinde), site actif global, droits par site | src/lib/sites.ts, src/lib/site-context.tsx, src/lib/user-functions.ts |
| Rôles / menus | `user_roles`, `user_module_access`, registre unique des modules | src/lib/access.ts, src/lib/module-access.tsx, src/components/ModuleGate.tsx |
| Clients | `clients` (ancien) et `customers` + `customer_addresses`, `customer_contacts`, `customer_vehicle_relations`, `customer_consents` (par canal, source WinMotor) | migrations 20260815133359, 20260815181822 ; src/lib/refbase.ts |
| Véhicules | `vehicles`, `ref_vehicles`, historiques kilométrage, `strictPlate` | src/lib/plate.ts, src/lib/vehicle-profile.ts |
| Demandes | `crm_requests` (site, canal dont « telephone », contact, plaque, priorité, statut) + `crm_request_events` | src/lib/crm.ts, src/routes/crm.index.tsx |
| Notifications | Destinataires e-mail par site `tour_notification_recipients` + journal `tour_notifications` | src/lib/tour-notify*.ts, src/lib/email.server.ts, src/routes/parametrage.notifications.tsx |
| Intégrations | `integration_credentials` chiffrées, page Paramètres API | src/lib/crypto.server.ts, src/routes/parametrage.api.tsx, src/lib/integration-status.ts |
| IA | Budget quotidien partagé, `ai_usage_log`, `runPaidAi` | src/lib/ai-usage.server.ts, src/lib/ai-budget-day.ts |
| Fichiers | Bucket privé `dda-media`, URL signées 5 min | src/lib/photo.ts, src/lib/order-docs.ts |
| Webhooks publics | Modèle `/api/public/*` (e-mails, Gmail) | src/routes/api/public/ |
| Absent | Aucun planning/RDV, aucune intégration Meta, Twilio, OpenAI, téléphonie | recherche src/ + migrations |

## 2. Réutilisable

Sites et droits (nouvelle clé de module `assistant`) ; `customers`/`vehicles`/`strictPlate` en lecture et rattachement proposé (jamais d'écriture directe dans le référentiel WinMotor) ; modèle `customer_consents` ; `crm_requests` comme modèle de suivi ; destinataires par site + e-mail + journal ; `integration_credentials` ; `runPaidAi` + budget ; `dda-media` ; modèle webhook public vérifié.

## 3. Architecture minimale

```text
Canaux (adaptateurs)            Socle commun DDA Assistant              Sorties
Messenger webhook  ──┐     ┌─ assistant_core (machine d'états) ─┐   fiche RDV / intervention / rappel
[Phase 2] Voix     ──┼──►  │  outils métier communs :            ├─► notif DDA + e-mail front office du site
[Futur] SMS / IG   ──┘     │  slots(), reserver(), modifier(),   │   réponse au canal
                           │  annuler(), escalader(), rappel()   │
                           └─ règles + réglages par site ────────┘
```

Tables (toutes avec `site_id`, RLS par site) : `assistant_channels` (site, type `messenger` | `voice` | `sms`, identifiant externe, actif), `assistant_contacts` (identifiant canal PSID ou numéro, lien customer facultatif), `assistant_conversations` (canal, état, priorité), `assistant_messages` (id externe unique), `assistant_appointments` + `assistant_appointment_events`, `assistant_interventions` + `assistant_intervention_events` (type intervention / demande de rappel / urgence), `assistant_notifications`, `assistant_notification_recipients`, `assistant_settings` (horaires, délai, offre 39 € TTC 1 h, questions simples autorisées, limites durée/coût).

Préparation voix dès la V1 (sans téléphonie) : type de canal `voice` prévu, `assistant_calls` réservé au schéma de la phase 2, outils métier indépendants du canal, fiche « demande de rappel » réutilisable.

## 4. Phase 2 — Accueil téléphonique hors horaires et débordement (spécification)

Principe définitif : messagerie évoluée, scénario unique.
- Les appels arrivent exclusivement par renvoi du standard existant (Paritel / 2L à confirmer). L'IA ne décide jamais quand décrocher ni combien de sonneries attendre.
- Le numéro appelé identifie le garage (site).
- Un seul dialogue, partout : même annonce, collecte, qualification, résumé, fiche, notifications et demande de rappel. Aucun transfert vers un humain, aucun scénario distinct.
- Étiquette de contexte, purement informative sur la fiche, calculée selon l'heure locale Europe/Paris et le calendrier du site : lun-ven 08:00-12:00 et 14:00-18:00 hors jours fériés = « débordement » ; tout autre moment (pause déjeuner, nuit, week-end, férié) = « hors ouverture / appel de nuit ». Même fonction de calendrier que les créneaux Messenger.

Déroulé :
1. Annonce claire : « assistant virtuel du garage », information RGPD courte (finalité, pas d'enregistrement audio).
2. Compréhension de l'objet, collecte prudente : prénom, nom, téléphone (pré-rempli par l'appelant si fourni, confirmé oralement), immatriculation (relue lettre par lettre, `strictPlate`).
3. Réponses limitées aux questions simples autorisées dans les réglages (horaires, adresse, offre en cours).
4. Priorité : normale / prioritaire / urgence. Urgence sécurité ou remorquage : consignes de sécurité génériques (se mettre en sécurité, gilet, triangle, 112 en cas de danger), invitation à contacter l'assistance de son contrat, aucune promesse de dépannage ni de délai, fiche marquée urgente.
5. Demande de rappel + résumé relu à l'appelant.
6. Fiche dans DDA Connect (conversation `voice`, résumé, priorité) et notifications au front office du site : Castillon = Delphine, Marc, Frédéric ; Lalinde à paramétrer plus tard.
7. Réservation par téléphone : plus tard, via les mêmes fonctions que Messenger, une fois celles-ci fiabilisées.

Exigences techniques : identifiant canal `voice` (numéro appelé → site) ; journal d'appel (début, fin, durée, étiquette de contexte, issue, coût) ; transcription et résumé texte seulement si autorisé, pas d'enregistrement audio par défaut ; coupure = fiche créée avec ce qui a été collecté et marquée « appel interrompu », rappel du même numéro dans un délai court = reprise de la même fiche ; durée maximale par appel et budget quotidien ; idempotence sur l'identifiant d'appel ; webhook signé.

Aucune promesse d'orientation ni de transfert : l'issue est toujours une fiche + une demande de rappel.

## 5. Risques

- **Meta** : app + vérification entreprise + revue `pages_messaging` ; fenêtre de réponse de 24 h ; jeton de Page à renouveler ; Instagram = revue distincte.
- **Téléphonie** : faisabilité du renvoi Paritel / 2L vers un numéro Twilio/SIP inconnue ; latence voix ; mauvaise reconnaissance des plaques et noms ; coût par minute.
- **Sécurité** : webhooks publics vérifiés ; jetons chiffrés côté serveur ; l'assistant ne révèle jamais de données client existantes (pas de « vous êtes déjà client avec tel véhicule »).
- **RGPD** : consentement avant collecte Messenger ; information orale en début d'appel ; durées de conservation ; effacement ; transfert vers le fournisseur IA à mentionner ; photos et transcriptions = données personnelles.
- **Doublons** : relivraison Meta / rappel du même appel → unicité sur l'id externe ; même personne sur plusieurs canaux → rattachement proposé, jamais fusion automatique.
- **Garanties RDV (réserve explicite)** : RDV confirmé par l'IA sans humain, sans agenda ni capacité. Le garde-fou empêche deux RDV IA sur le même créneau, pas un conflit avec un RDV pris par téléphone, au comptoir ou dans WinMotor, ni une absence de personnel ; le garage corrige alors la fiche et prévient le client.
- **IA** : prix, horaires et règles injectés depuis les réglages, jamais inventés ; budget IA partagé avec le reste de DDA.

## 6. Étapes et crédits Lovable (fourchettes indicatives)

V1 Messenger Castillon :

| # | Étape | Crédits |
|---|---|---|
| 1 | Tables, RLS par site, module `assistant`, réglages Castillon (canal `voice` prévu) | 8 – 15 |
| 2 | Règles de créneaux (fériés FR) + garde-fou doublon + tests | 5 – 10 |
| 3 | Moteur de conversation : réservation, modification, annulation, escalade + tests | 16 – 30 |
| 4 | Webhook Meta (vérification, signature, idempotence) + envoi | 8 – 15 |
| 5 | Notifications DDA + e-mails (création, modification, annulation, intervention) | 5 – 9 |
| 6 | Écrans DDA : conversations, fiches RDV, « Intervention nécessaire » avec suivi, réglages | 13 – 24 |
| 7 | Consentement, mentions RGPD, purge / export | 4 – 8 |
| 8 | Recette réelle Messenger (mode test Meta) et corrections | 8 – 20 |
| | **Total V1** | **≈ 67 – 131** |

Phase 2 voix, scénario unique (séparée) :

| # | Étape | Crédits |
|---|---|---|
| V1 | Étude raccordement Paritel / 2L + choix opérateur (Twilio ou SIP) | 2 – 5 |
| V2 | Schéma `assistant_calls`, journal, numéro → site, étiquette de contexte (réutilise le calendrier Messenger) | 4 – 8 |
| V3 | Adaptateur voix temps réel + webhook appel + idempotence | 15 – 30 |
| V4 | Script unique : accueil, collecte, questions autorisées, priorité/urgence, rappel + tests | 10 – 20 |
| V5 | Fiches et notifications voix, coupure/reprise, limites durée/coût | 6 – 12 |
| V6 | Recette avec appels réels et corrections | 8 – 20 |
| | **Total phase 2** | **≈ 45 – 95** (au lieu de 55 – 119) |

La simplification réduit l'estimation d'environ 10 à 24 crédits : suppression du transfert humain conditionnel, d'un second scénario et de leurs tests ; l'étiquette réutilise la règle de calendrier déjà prévue pour Messenger.

Coût d'exploitation (hors Lovable, à confirmer sur les grilles en vigueur) : Messenger API gratuite ; IA texte ≈ quelques centimes par conversation, plafonnable. Voix : numéro ≈ 1–3 €/mois ; minutes entrantes ≈ 0,01–0,03 €/min ; voix IA temps réel ≈ 0,05–0,30 €/min ; ex. 300 appels/mois × 3 min ≈ 50–300 €/mois ; éventuel coût de renvoi facturé par Paritel / 2L.

## 7. Critères de recette

V1 Messenger :
- Aucun créneau proposé un week-end, un jour férié français (ex. 11/11, 25/12, lundi de Pâques) ou à moins de 4 jours ouvrés.
- Réservation complète = une seule fiche RDV visible dans DDA (Castillon) + un seul e-mail détaillé aux trois destinataires, personne d'autre.
- Récapitulatif client : offre 39 € TTC, 1 h, bilan hiver offert, date/heure, véhicule.
- Message relivré ou double envoi : ni deuxième fiche ni deuxième e-mail.
- Créneau déjà réservé par l'IA non proposé ; deux réservations simultanées : une seule réussit, l'autre reçoit une alternative.
- Modification : même fiche, historique, nouveau récapitulatif, notification + e-mail. Annulation : fiche « annulée », créneau libéré, récapitulatif, notification + e-mail.
- Question hors périmètre ou demande urgente : fiche « Intervention nécessaire » + e-mail, suivi jusqu'à « résolue » avec auteur et date.
- Aucune collecte avant consentement ; un utilisateur Lalinde ne voit pas les fiches Castillon.

Phase 2 voix :
- L'assistant n'intervient que sur appel renvoyé par le standard ; il s'annonce comme assistant virtuel dès la première phrase.
- Dialogue identique quel que soit le moment ; aucun transfert tenté.
- Étiquette (heure de Paris) : mardi 10:30 = « débordement » ; mardi 12:30, mardi 19:00, samedi 10:00, 11/11 à 10:00 = « hors ouverture / appel de nuit ».
- Le numéro appelé détermine le site et donc les destinataires.
- Fiche créée avec nom, téléphone, plaque relue, objet, priorité, résumé ; notification au front office du site appelé uniquement.
- Urgence sécurité/remorquage : consignes sûres, aucune promesse de délai ou de dépannage.
- Aucun enregistrement audio stocké par défaut ; transcription seulement si activée.
- Coupure : fiche « appel interrompu » conservée ; rappel du même numéro rattaché à la même fiche.
- Durée maximale et budget quotidien respectés ; même identifiant d'appel = une seule fiche.

## 8. À confirmer

1. Page Facebook Castillon : admin, Business Manager vérifié ? Instagram en V1 ou plus tard ?
2. IA via Lovable (sans clé) plutôt qu'une clé OpenAI propre ?
3. Adresses e-mail de Delphine, Marc, Frédéric ; numéro du garage pour les urgences.
4. Fermetures exceptionnelles (congés) à saisir ? 4 jours ouvrés comptés depuis le jour du message ?
5. Délai limite pour modifier/annuler via la conversation ?
6. Rattachement au client WinMotor existant ou prospects séparés jusqu'à vérification ?
7. Durées de conservation (conversations, photos, transcriptions) et texte RGPD.
8. Téléphonie : opérateur exact (Paritel ou 2L), renvoi possible vers un numéro externe ou SIP, et le numéro appelé d'origine est-il transmis lors du renvoi ?
9. Numéros appelés de chaque garage (Castillon, Lalinde).
10. Questions simples autorisées au téléphone ; transcription texte autorisée ou non.
11. Assistance remorquage à indiquer (numéro garage, assisteurs) ; durée max d'appel et budget mensuel voix.
12. Destinataires Lalinde (plus tard).
