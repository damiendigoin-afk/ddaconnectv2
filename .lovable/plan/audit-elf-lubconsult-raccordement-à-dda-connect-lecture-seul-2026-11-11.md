# Audit ELF LubConsult — raccordement à DDA Connect (lecture seule)

Aucun code, aucune donnée, aucune publication. Ce document est un audit et une proposition de voie.

## 1. Ce qui existe déjà dans DDA Connect (vérifié dans le code)
- **Ixellio** : modèle de référence pour un outil externe authentifié. Identifiants par site stockés côté serveur (`ixellio-store.server.ts`), session partagée (`openIxellioSession`), fonctions serveur authentifiées (`ixellio.functions.ts`), parseur séparé (`ixellio-parse.ts`, `ixellio-map.ts`), cache anti-doublon (`ixellio-lookup-cache.ts`), verrou + intervalle 15 s, lecture seule.
- **Provenance** : `field_provenance`, `field_changes`, colonnes `*_source` (ajoutées pour les dates véhicule) — réutilisables pour tracer « huile recommandée : source ELF ».
- **Briques huile** : aucune intégration lubrifiant. Seulement : catégorie de forfait `oil` (`packages-parse.ts`), règle « pas de vidange sur véhicule électrique » (`vehicle-profile.ts`), lignes d'achat contenant « huile ». Aucun champ huile / viscosité / capacité / norme constructeur sur la fiche véhicule.
- **Données véhicule utiles** : plaque, VIN, marque/modèle, code moteur. Attention : pour GY-640-HM, la fiche WinMotor et le parseur Ixellio sont connus pour donner un code moteur incertain (`H5F_601` vs `H5F B6`) — à ne pas utiliser seul comme clé.

## 2. Validé / non validé
Validé (par vous, manuellement) : l'interface publique ELF donne pour GY-640-HM Evolution Full-Tech R FE 0W-16, 4,3 L, codes 235386 / 235387.
Validé (par vous) : appels directs `/api/lubadvisor/...` → 401.
Non validé :
- le mécanisme d'authentification de l'iframe (jeton de session, clé liée à `configuration=649`, origine/Referer) ;
- l'existence d'une API partenaire officielle TotalEnergies / ELF et ses conditions ;
- les conditions d'utilisation de lubconsult (réutilisation automatisée, stockage, affichage dans un logiciel tiers) ;
- la recherche par plaque ou VIN (l'UI semble chercher par marque/modèle/motorisation — à confirmer).

## 3. Position : ne pas contourner le 401
Rejouer le jeton de l'iframe, imiter le Referer ou automatiser un navigateur pour lire l'API serait un contournement d'un contrôle d'accès et probablement contraire aux CGU. Non recommandé.

## 4. Voie autorisée recommandée (par ordre de fiabilité)
1. **Demande officielle à TotalEnergies Lubrifiants** (votre interlocuteur commercial ELF / distributeur) : accès API LubAdvisor partenaire ou clé dédiée au garage, avec CGU écrites autorisant l'usage dans DDA. Voie la plus fiable.
2. **Intégration iframe officielle dans DDA** (sans lecture des données) : afficher le configurateur ELF dans la fiche véhicule / OR, comme l'atelier le fait déjà. Zéro automatisation, mais zéro risque, et possible tout de suite si les CGU autorisent l'embed (le paramètre `?iframe&configuration=649` suggère un usage prévu pour l'intégration).
3. **Saisie assistée tracée** : après consultation ELF, l'opérateur reporte produit / viscosité / capacité / code article dans DDA, avec source « ELF LubConsult (saisie) » et date. Déterministe, auditable.
4. Si une API partenaire est obtenue : connecteur sur le modèle Ixellio (identifiants serveur par site, cache par VIN/motorisation, une requête, pas de boucle, lecture seule, proposition à confirmer, jamais d'écrasement).

## 5. Tests techniques non destructifs à faire (après accord)
- Lire les CGU / mentions légales de elf.com et lubconsult.totalenergies.com (embed, automatisation, réutilisation des données).
- Charger une fois la page iframe dans un navigateur et observer, sans rejouer, comment l'auth est fournie (en-têtes, cookie, jeton) — pour documenter pourquoi le 401, pas pour l'exploiter.
- Vérifier si l'iframe peut s'afficher dans DDA (en-têtes `X-Frame-Options` / `frame-ancestors`).
- Vérifier si la recherche accepte VIN/plaque ou seulement modèle/moteur.
- Aucun appel en boucle, aucun jeton réutilisé, aucun stockage de réponse.

## 6. Risques
- Juridique / CGU : réutilisation automatisée non autorisée.
- Technique : API privée susceptible de changer sans préavis.
- Métier : mauvaise motorisation (Austral E-Tech 160 vs 200, code moteur incertain) → mauvaise huile ou capacité. Toujours confirmation humaine.
- Capacité « théorique » ≠ quantité réelle : l'afficher comme indicative.

## 7. Points d'intégration concrets (futurs, non codés)
- Fiche véhicule : bloc « Lubrifiant recommandé » (produit, viscosité, norme, capacité indicative, codes article, source, date) + bouton « Ouvrir ELF ».
- OR / forfait vidange (catégorie `oil`) : pré-remplir la référence et la quantité proposées, à confirmer.
- Pièces & achats : rapprocher les codes 235386 / 235387 avec le catalogue / stock.
- Provenance via `field_provenance` / `field_changes`.
- Nouveaux champs = migration dédiée, seulement après accord.

## Décision attendue
Choisir : (a) démarche officielle TotalEnergies, (b) embed iframe + saisie assistée en attendant, ou les deux. Je recommande les deux.
