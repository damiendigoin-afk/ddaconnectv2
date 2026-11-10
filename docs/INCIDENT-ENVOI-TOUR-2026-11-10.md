# Envoi client — GY-640-HM — 10 novembre 2026

## Cause vérifiée

Inspection `a9cd512d-a32f-45a0-9ffb-ea0ddbcffcac` : statut `completed`, clôturée le 9 novembre à 13:50:20 UTC, 74 lignes de contrôle présentes. Le compte de l’opérateur est actif, possède le menu `tour` et est rattaché au même site.

Le client publishable sans session de `report-email.server.ts` était anonyme. La politique SELECT impose `is_active_user(auth.uid())`. Reproduction avant correctif : GET anonyme HTTP 200, zéro ligne ; `.single()` et toute erreur étaient convertis en « Tour introuvable ». La fiche n’était ni absente ni perdue.

## Correction

- Endpoint protégé par l’authentification gérée ; rejet sans session journalisé, HTTP 401.
- Avant lecture privilégiée : compte actif, rôle manager ou accès au menu concerné, lecture sous RLS de l’utilisateur, accès au site par la fonction existante. Sans site : réservé aux managers, sans modification du dossier.
- Si la lecture utilisateur ne retourne rien : vérification privilégiée limitée à l’existence de l’ID, après identité/compte/menu ; ligne existante cachée = refus, jamais autorisation d’envoi. Aucun contenu privé retourné.
- Client admin généré, importé côté serveur seulement, après autorisation ; sa gestion correcte des clés opaques est conservée. Aucune connexion utilisateur sur ce client, aucune migration ni politique permissive.
- Résultats distincts : `unauthenticated`/401, `forbidden`/403, `not_found`/404, `database`/500, `send`/502. Pour les erreurs récupérables, ces valeurs sont dans le résultat RPC ; ce n’est pas un endpoint REST.
- Journal serveur dès les vérifications initiales, puis tentative `email_logs` avant chargement complet. Erreurs détaillées côté serveur, URLs/bearers masqués, messages clients filtrés. Erreur de lecture des contrôles bloque l’envoi plutôt que de fabriquer un rapport vide.
- Format, destinataires saisis, message et service d’envoi conservés. Succès seulement avec identifiant d’acceptation fournisseur. Horodatage d’envoi uniquement après acceptation ; panne de suivi post-envoi journalisée sans déclencher un second envoi.
- Analogue expertise : même contrôle d’accès, suppression du client anonyme, erreurs de chargement filtrées/journalisées. Renvoi manuel Front Office et circuit de clôture contrôlent désormais le même accès avant d’appeler leurs services existants ; fallback reste interne au circuit autorisé.

## Fichiers

- `src/lib/report-access.server.ts`, `src/lib/report-auth.ts`
- `src/lib/report-email.server.ts`, `src/lib/report-email.functions.ts`
- `src/lib/expertise-email.server.ts`, `src/lib/expertise-email.functions.ts`
- `src/lib/tour-notify.functions.ts`, `src/lib/tour-close.functions.ts`
- `src/routes/tour.$tourId.rapport.tsx`, `src/routes/expertise.$exId.rapport.tsx` : appels via `useServerFn`, aucune refonte de l’écran.
- `src/lib/__tests__/report-email.server-test.ts`, `vitest.server.config.ts`
- `AGENTS.md`, `roadmap.md`, présent bilan.

## Vérification

- 16 nouveaux tests serveur : utilisateur autorisé/client envoyable avec service simulé, endpoint non authentifié, helper sans identité, compte désactivé, ID inconnu, RLS explicite/cachée, mauvais site, menu absent, panne BDD initiale, panne contrôles, refus fournisseur, réponse sans ID, exception fournisseur, expertise désactivée, manager. Avec les 3 régressions pneus : **19/19**.
- Suite existante : **1 395/1 396** ; unique timeout de 5 secondes dans `tire-quote-pdf.test.ts`, déjà intermittent avant ce lot. Rejeu isolé : **6/6**. Aucun changement dans ce PDF.
- Compilation automatique : `build OK`.
- Vérification réelle, sous la session du demandeur : autorisation serveur réussie sans écriture ; lecture authentifiée HTTP 200 avec une ligne terminée ; formulaire du vrai rapport ouvert et destinataire prérempli. Capture du formulaire inspectée.
- Aucun mail réel envoyé, aucune mutation des données métier existantes pendant les vérifications, aucune migration, aucune publication. Livraison réelle au client, session propre à Styven et résultat après déploiement **non vérifiés**. La correction n’est pas encore en production.