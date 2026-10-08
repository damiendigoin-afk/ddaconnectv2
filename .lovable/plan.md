# Diagnostic production — "Internal server error"

## Cause probable : déploiement (outil de build du serveur), pas l'auth ni la base

Preuves :
- Toutes les pages de production renvoient l'erreur 502 "Internal server error", y compris `/`, `/auth` et même `/favicon.ico`. Ce n'est donc pas lié à la connexion, ni à une page, ni à une requête en base.
- Le journal du serveur montre la même erreur à chaque requête, avant tout code applicatif :
  `TypeError: The argument 'path' ... Received 'undefined' at createRequire (node:module) at _runtime.mjs:1:883`.
  Le serveur publié plante dès son démarrage, dans son environnement d'exécution généré.
- Le commit 51a42ed (07/10 15:01) a modifié `package.json` et `bun.lock` : l'outil de build `@lovable.dev/vite-tanstack-config` est passé de 2.23.1 à 2.25.3. C'est le seul changement d'infrastructure. Le code métier (lecture du BL) ne s'exécute pas au démarrage.
- Les migrations 0048/0049, la sécurité d'accès aux données (RLS) et l'auth ne sont pas en cause. La page plante avant toute lecture en base ou toute session.

Catégorie : déploiement / serveur (build). Pas un problème d'écran, d'auth ni de base.

## Correctif minimal (à appliquer après accord)
1. Remettre `@lovable.dev/vite-tanstack-config` à `2.23.1` dans `package.json`, la dernière version connue qui fonctionne, et réinstaller.
2. Republier, puis vérifier que `/`, `/auth` et la connexion Google renvoient 200.
3. Remarque : le commit 19c0b5e de ce matin a encore modifié `package.json`. Il faut vérifier quelle version il fixe avant de republier.

## Retour arrière possible
Via l'historique, restaurer la version d'avant 51a42ed puis republier. On perd seulement la correction de lecture du BL CAZES sans OR, qu'on pourra réappliquer ensuite sans toucher à l'outil de build.
