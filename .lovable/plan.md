# Audit — Recherche de pièces IXELLIO par référence (stock mort)

Audit seul : aucun code, aucune donnée, aucune migration, aucune publication.

## Ce que le code prouve déjà

- **Identifiants** : `ixellio-store.server.ts` stocke un seul compte chiffré (`integration_credentials`, provider `ixellio`), lu par `loadCredentials()` côté serveur uniquement. Réutilisable tel quel.
- **Connexion** (`ixellio.server.ts`, `runIxellioAuthTest`) : GET `/index.html` pour les cookies → champs cachés du formulaire → POST `/j_spring_security_check` (`j_username`, `j_password`) → redirections suivies jusqu'à `mainMenu.html`. Cookies gardés en mémoire pendant la requête seulement ; trace nettoyée (`safePath`).
- **CSRF** : Spring exige `_csrf` sur les POST (absent → HTTP 403, constaté le 27/09/2026). `extractCsrf()` ne vise que le formulaire `ident_admin_search_immat` ; il faudra une variante pour le formulaire de recherche pièces.
- **Licence mono-session** : une seule reprise avec cookie jar neuf déjà prévue dans `runIxellioWithStoredCredentials`. Une recherche de pièces doit passer par le même verrou, sinon elle peut déconnecter un utilisateur IXELLIO.
- **Aucun code pièces** : pas de `PieceRecherche` ni `searchReference` dans le projet.

## Ce qui n'est PAS prouvé (à relever dans DevTools)

Ce que montre la capture : URL `/PieceRecherche.html?method=searchReference`, 3 résultats à 119,25 € pour 214992066R. À relever dans l'onglet Réseau en lançant la recherche dans Chrome, puis en copiant « as cURL » sans cookies :
1. La méthode (GET ou POST) et le nom exact du paramètre de référence (`reference`, `ref`, `searchText`… : inconnu).
2. Le `_csrf` : s'il est requis, de quelle page il vient (le formulaire de `PieceRecherche.html` ou celui du menu), et l'`id` du formulaire.
3. Les autres champs envoyés (marque, type de recherche, filtres, véhicule en contexte) et le Referer attendu.
4. Si les résultats sont dans la page HTML ou chargés à part (requête XHR/JSON, `ajax=1`).
5. Le HTML d'une ligne de résultat (clic droit → Copier l'élément, sur une ligne anonymisée) : référence, marque/équipementier, libellé, colonnes de prix et leurs en-têtes.
6. **Le prix** : 119,25 € est-il HT ou TTC, prix public ou net remisé ? Il faut le lire dans l'en-tête de colonne ou la mention de la page. Sans libellé explicite, on ne le déduit pas : le prix est stocké avec `price_basis = "unknown"`.
7. Les 3 résultats : équivalences ou fournisseurs différents ? Repérer le champ qui les distingue.

## Vérification en direct

Non faite. Elle exige d'exécuter du code serveur avec les identifiants déchiffrés, ce que ce mode lecture seule interdit. De plus, aucun point d'appel pièces n'existe encore. Elle est possible après accord, avec un seul appel lecture seule : il renverrait seulement le statut HTTP, les noms de champs, le nombre de lignes et les en-têtes de colonnes, sans HTML, cookies ni secrets.

## Comment réutiliser le code existant (après accord)

```text
runIxellioWithStoredCredentials ──► session (login + jar)
        ├─ recherche immat (existant)
        └─ searchPartByReference(ref)  [nouveau]
              GET PieceRecherche.html (page du formulaire) → extractCsrf(form id)
              requête relevée en DevTools (+_csrf)
              parseIxellioParts(html) → lignes {ref, marque, libellé, prix, price_basis}
```

1. Extraire de `runIxellioAuthTest` une fonction `openIxellioSession()` (login + jar), partagée par l'immat et les pièces, sans changer le comportement de la recherche immat.
2. Rendre `extractCsrf(html, formId)` paramétrable : `ident_admin_search_immat` reste la valeur par défaut.
3. Nouveau module de parsing pur `ixellio-parts-parse.ts`, testé sur une fixture anonymisée du HTML relevé. Prix lu seulement si la colonne est libellée HT ou TTC ; détection d'un retour à la page de login.
4. Nouvelle fonction serveur réservée aux utilisateurs connectés, en lecture seule : référence normalisée, aucun enregistrement automatique. Le stock mort affichera les résultats et l'utilisateur décidera.
5. Tests : CSRF, paramètres, parsing (3 lignes, 119,25, `price_basis`), session expirée, référence introuvable.

Estimation : 15–30 crédits une fois les relevés DevTools fournis.

## Bloquant

Les points 1 à 6 ci-dessus. Sans eux, les noms de paramètres et la nature du prix restent des hypothèses.
