# Diagnostic — devis 195/55R15 95H indisponibles (06/11/2026)

Lecture seule. Rien n'a été modifié. Le diagnostic West Lake du 02/11 est résumé en bas.

## Faits observés en base
- 07:52:22 et 07:52:46 UTC : 2 devis 195/55R15 95H, sans immatriculation ni nom client. Les 6 cases indiquent « Aucune offre conforme ».
- 07:54:04 UTC : 1 devis 195/65R15 95H, même site. Les 6 offres sont disponibles et chiffrées (Risen, Kleber, Michelin, Hankook).

## 1) Pourquoi le message parle de 245/45 R20
`summarizeDistricashTest` (`src/lib/districash-session.server.ts` l. 196-208) a été écrite pour le bouton « Tester » des Paramètres, qui cherche toujours 245/45 R20. Le texte « 245/45 R20 » y est écrit en dur. Le devis réutilise la même fonction (`src/lib/districash-search.server.ts` l. 28-29). Il affiche donc la mauvaise dimension. Ce n'est qu'un problème de message : la recherche, elle, envoie bien la dimension saisie (`districashSearchBody`, l. 168-182).

## 2) Pourquoi 0 ligne lue — pas de régression
- La connexion fonctionne : le message dit « Authentification confirmée », ce qui suppose que l'étape `GET /` a répondu « page connectée ».
- La recherche et le parseur fonctionnent : le devis 195/65R15 lancé 1 min 20 s plus tard, même compte, même code, a lu des produits avec prix.
- Cause probable : Districash n'a rien trouvé pour 195/55R15 indice 95. Cet indice de charge est inhabituel pour cette dimension (en général 85H, ou 88 en XL). La recherche transmet l'indice de charge (`pneu_indc`), ce qui donne un résultat vide légitime (HTTP 200, 0 ligne).
- Défaut de logique : `districashLoginAndSearch` (l. 106-108) traite « aucun produit » comme « catalogue non validé ». `authenticated` passe alors à `false` et un résultat vide normal remonte comme une panne d'authentification ou de catalogue.
- Non prouvé : la page HTML renvoyée n'est pas conservée. Pour confirmer, il faut faire la même recherche dans le portail.

## 3) La hauteur 55 peut-elle venir du devis 195/65 d'origine ?
Non, pas par le code. Le formulaire `devis.pneus.index.tsx` (l. 108-111) part vide, ou des seuls paramètres d'URL `w/h/d/li/si` (préremplissage depuis l'étape pneu, lecture du flanc). Il ne relit jamais un devis enregistré. Les deux devis n'ont ni plaque ni nom client : ils ne viennent pas du devis POIRIE. Deux origines possibles pour le 55 : saisie manuelle, ou lecture photo du flanc (préremplissage `h=55`), suivie d'une correction en 65 à 07:54. On ne peut pas trancher sans trace d'interface.

## 4) Correctif minimal proposé (à valider)
1. Dans `districashLoginAndSearch`, séparer « session prouvée » et « produits trouvés » : si la connexion est confirmée et la recherche répond 200, renvoyer `authenticated: true` avec 0 ligne. Le moteur affichera alors « aucune offre », pas une erreur.
2. Créer `summarizeDistricashSearch(r, tyre)` pour le devis : message avec la dimension réelle, par exemple « Districash : aucun pneu 195/55 R15 95H au catalogue ». Garder `summarizeDistricashTest` pour le seul bouton des Paramètres.
3. Facultatif : avertir quand l'indice de charge est inhabituel pour la dimension, sans bloquer.

Tests à ajouter :
- recherche HTTP 200 sans ligne `ARTICLE_CONTENT` → résultat authentifié, 0 ligne, message sans « 245/45 » ;
- le message du devis contient la dimension demandée ;
- un échec de connexion reste une erreur ;
- le test des Paramètres est inchangé.

## Rappel — West Lake 1956515HZ401XL (devis POIRIE du 02/11)
- Le 40,80 € n'est pas le montage : 17 € HT × 2 × 1,20 = 40,80 TTC, ajouté après coup. La coïncidence de montant est fortuite.
- Le prix d'achat vient uniquement de l'attribut `data-filtreprixachat` de la page de recherche (`src/lib/districash.ts` l. 155, l. 252). Il n'y a ni cache ni calcul de remise.
- Le relevé a varié de 40,80 à 51,21 € selon les jours. Deux causes possibles : prix plus bas ce jour-là, ou attribut qui n'est pas le PA net du panier (60,08 €). Tous les devis Districash utilisent cet attribut.
- À vérifier : comparer le jour même le prix de recherche, de fiche et de panier.
