# Centre de connexions externes (Paramètres API)

Objectif : garder la page actuelle « Paramètres API » (/parametrage/api) et en faire le seul endroit où l'on voit et gère toutes les connexions externes, avec des statuts compréhensibles. Aucun autre module n'est touché (chiffrage, forfaits, tours véhicule inchangés).

## Ce que verra l'utilisateur

Une page en deux sections :

1. **Services par clé** (existants, conservés) : Emails, Géocodage / temps de trajet, OCR / lecture de documents, Stockage de fichiers, plus une nouvelle carte **IXELLIO**.
2. **Communication** (nouveau, connexions par bouton) : Meta (Facebook + Instagram + compte publicitaire), Google Business Profile, Google Ads.

Chaque carte affiche : un statut clair, le compte/page relié, le ou les sites affectés (Lalinde, Castels ou Groupe), la date de la dernière vérification, le message du dernier test, et les actions Tester / Modifier l'affectation / Déconnecter.

### Statuts

| Statut | Sens |
| --- | --- |
| Non configuré | aucune clé ni compte relié |
| Configuré | clé ou compte présent, jamais testé |
| Testé | dernier test réussi mais service mis en pause |
| Actif | testé avec succès et activé |
| Erreur | dernier test en échec, avec le message affiché |

Une clé présente n'affiche plus « Inactif » seul : elle affiche « Configuré — jamais testé » ou « Erreur — <message> ».

### IXELLIO

La carte IXELLIO reprend exactement ce qui existe aujourd'hui dans Paramétrage global : statut, date de mise à jour, modification des identifiants, immatriculation de test, bouton de test. Les identifiants déjà enregistrés et chiffrés sont réutilisés tels quels, aucun doublon n'est créé. Dans Paramétrage global, le bloc est retiré et remplacé par un lien « Connexions externes » vers Paramètres API.

### Meta / Google

Pas de saisie de secrets par l'utilisateur : boutons « Connecter avec Meta » et « Connecter avec Google ». Les jetons restent côté serveur, chiffrés, jamais affichés. Après connexion, l'écran liste les pages Facebook, comptes Instagram, comptes publicitaires ou établissements disponibles et permet d'affecter chacun à Lalinde, Castels ou Groupe (un seul compte Google et un seul compte Meta pour les deux sites).

## Détail technique

### Base de données (une migration)

- `api_settings` : ajout de `category text not null default 'cle'` et `sort_order int default 100`, plus une ligne `ixellio` (carte pilotée par `integration_credentials`, pas par un secret d'environnement).
- Nouvelle table `integration_connections` : `id`, `provider` (`meta`, `google_business`, `google_ads`, extensible), `status`, `account_label`, `account_external_id`, `access_token_enc`, `refresh_token_enc`, `expires_at`, `scopes text[]`, `last_check_at`, `last_check_ok`, `last_check_message`, `connected_by`, timestamps. GRANT `service_role` uniquement + `SELECT` `authenticated` sur une vue/colonnes sans jetons ; RLS activée, lecture manager.
- Nouvelle table `integration_targets` : `id`, `connection_id` (FK cascade), `kind` (`fb_page`, `ig_account`, `ad_account`, `gbp_location`), `external_id`, `name`, `site_id uuid null`, `scope text` (`site` | `groupe`), timestamps, unicité (`connection_id`, `kind`, `external_id`). GRANT + RLS manager.
- `integration_credentials` : inchangée (IXELLIO conservé).

### Fichiers

Nouveaux :
- `src/lib/integrations.ts` — types et registre générique des connexions (id, libellé, catégorie, mode `cle` | `oauth`, actions disponibles) ; c'est le point d'extension pour les API futures.
- `src/lib/integrations.functions.ts` / `src/lib/integrations.server.ts` — server functions manager : lister les connexions (sans jetons), lancer un test, enregistrer les affectations, déconnecter. Chiffrement via `src/lib/crypto.server.ts` existant.
- `src/routes/api/public/oauth/meta.callback.ts` et `.../google.callback.ts` — retours OAuth, échange du code, stockage chiffré ; `state` signé et vérifié.
- `src/components/IntegrationCard.tsx` — carte générique (statut, compte, sites, dernier test, actions), utilisée par toutes les connexions.
- `src/components/IntegrationTargets.tsx` — affectation page/compte/établissement → site.

Modifiés :
- `src/routes/parametrage.api.tsx` — deux sections, carte générique, statuts enrichis, carte IXELLIO (réutilise `getIxellioSettings`, `saveIxellioSettings`, `testIxellioAuth` déjà existants).
- `src/routes/parametrage.global.tsx` — suppression du bloc `IxellioSettings`, remplacé par un lien vers Paramètres API.
- `src/routes/api/public/api-check.ts` — retour enrichi (statut + message) pour les services par clé.

### Secrets

Meta et Google Ads/Business nécessitent un identifiant d'application côté serveur. Le plan prévoit d'utiliser en priorité un connecteur Google déjà disponible dans la plateforme pour Google Ads ; pour Meta, il faudra ajouter `META_APP_ID` et `META_APP_SECRET` dans les secrets du projet (à faire au moment de l'implémentation, pas maintenant). Tant qu'ils sont absents, la carte Meta affiche « Non configuré — application Meta à déclarer » sans casser la page.

### Vérifications

Typecheck, suite de tests complète, build. Tests ajoutés : calcul du statut d'une connexion, affectation site/groupe, absence de fuite de jeton dans les données renvoyées au navigateur. Aucune publication automatique.

### Découpage proposé

1. Migration + refonte de la page avec statuts clairs + carte IXELLIO + retrait du doublon dans Paramétrage global (coût faible, entièrement testable tout de suite).
2. OAuth Meta / Google et affectation aux sites (dépend des identifiants d'application).
