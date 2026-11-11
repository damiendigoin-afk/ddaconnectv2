# Diagnostic IXELLIO catalogue pièces — « champs — » et 0 ligne

Lecture seule. Rien n'est modifié ni publié. Constat : la recherche par référence **n'est pas validée**. Le statut « ok » signifie seulement que la session a tenu (pas de redirection, pas de page de connexion). Il ne prouve pas qu'IXELLIO a fait la recherche demandée.

## 1. Pourquoi « champs : — »
`partsFormFieldNames` ne lit que l'intérieur d'un `<form …searchReference…>`, trouvé dans la balise d'ouverture elle-même. Dans la page GET (27 463 o), aucune balise `<form>` ne contient ce texte. Causes possibles :
- l'action est `PieceRecherche.html` et la méthode passe par un champ caché (`method=searchReference`) ou par JavaScript (`form.action = …`, `onclick`) ;
- la recherche se fait par AJAX, sans formulaire classique.

Le jeton CSRF « oui » vient donc du **repli** : premier `_csrf` de la page, ou de la page de connexion. Il n'est pas forcément rattaché au bon formulaire.

## 2. Pourquoi 0 ligne
Le POST envoie seulement `reference=…&_csrf=…`. Le nom `reference` a été **supposé**, jamais relevé. Les en-têtes détectés sont vides : aucun tableau n'a une première ligne contenant « réf » ou « prix ». Le parseur ignore les tableaux sans ces mots, et `noResult` est faux (aucun texte « aucun résultat »).

## 3. Hypothèses classées
1. **Le plus probable : mauvais nom de champ ou paramètre manquant** (type de recherche, marque, mode). La réponse de 58 Ko (contre 27 Ko pour la page vide) serait alors la page de recherche rechargée avec un message de validation ou des listes, pas des résultats. Cela concorde avec les champs « — ».
2. **Résultats présents mais structure non prévue** : en-têtes en `<thead>` avec une ligne de titre avant, des `<div>` au lieu d'un tableau, ou des tableaux imbriqués. La regex `<table[\s\S]*?</table>`, qui s'arrête au premier `</table>`, coupe les tableaux imbriqués.
3. **Résultats chargés ensuite par AJAX ou JSON** : le POST renvoie une coquille, puis un autre appel charge les lignes.
4. **Méthode ou URL différente** : la vraie action est `searchReferenceXxx` ou passe en GET. La réponse 200 serait alors une page par défaut.
5. **Session ou contexte incomplet** : un véhicule ou un dossier doit être sélectionné avant de chercher. Moins probable, car il n'y a pas de redirection vers la connexion.

## 4. Instrumentation minimale (non sensible)
Ajout au diagnostic manager seulement. Aucun HTML brut, aucune valeur de champ caché, aucun cookie, CSRF ou identifiant.
- **Page GET, inventaire des formulaires** : pour chaque `<form>`, l'action (chemin + `method` seulement), la méthode HTTP, et les noms/types des champs. Les `select` donnent leur nombre d'options et leurs libellés courts. Les `hidden` donnent leur nom seulement, `_csrf` est masqué.
- **Indices JavaScript** : la liste des valeurs `method=…` et des URL `*.html` / `*.do` / `ajax|json` trouvées dans les `<script>` (chemins seulement, sans paramètres).
- **Réponse POST, structure** : `<title>`, titre `h1`/`h2`, et les 3 premiers messages d'erreur ou d'alerte (classes `error|alert|message`, 120 caractères max, référence masquée). Pour chaque tableau (imbriqué ou non) : nombre de lignes, de colonnes et les textes des 2 premières lignes d'en-tête (`th` ou première ligne). Nombre de `div` répétés porteurs de classes du type `result|piece|ligne`.
- **Présence de la référence** dans la réponse : oui/non et nombre d'occurrences, sans contexte autour.
- Aucun appel supplémentaire. On garde le même login unique, le verrou et l'intervalle de 15 s. Un seul clic de test, hors heures d'atelier, puisque la licence est mono-session.

## 5. Plus petit correctif, après relevé
- Remplacer les noms de champs supposés par ceux relevés : construire le corps à partir des champs réels du bon formulaire. On reprend les valeurs par défaut des champs cachés et `select` non sensibles, on remplit le champ référence, et on utilise l'action relevée.
- `partsFormFieldNames` / `extractPartsCsrf` : repérer le formulaire par son action **ou** par un champ `method=searchReference`.
- Parseur : en-têtes cherchés dans `<thead>` ou dans les 2 premières lignes, et prise en charge des tableaux imbriqués. Pas de règle devinée pour les `div` tant que la structure n'est pas relevée.
- Statut : un résultat sans ligne et sans « aucun résultat » doit afficher « structure non reconnue » et non « ok ».

## 6. Validation
- Tests unitaires du parseur et de l'inventaire sur des extraits synthétiques reproduisant la structure relevée. Pas d'HTML IXELLIO réel stocké.
- Un appel réel unique avec 214992066R : on attend au moins une ligne avec correspondance exacte, une désignation, et un prix avec base HT/TTC issue de l'en-tête. Puis une référence inexistante : on attend « aucun résultat ».
- Vérifier que la session atelier n'est pas délogée : un seul login dans la trace.
- Pas de publication sans votre accord.
