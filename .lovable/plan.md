# Audit : comment les marques de pneus sont classées (lecture seule, rien modifié)

## 1. Sources de gamme
- **Réglages du garage** (Paramètres > Chiffrage & pneumatiques) : une gamme par marque, avec ordre et marque par défaut. Règle commune à tous les sites. Une marque réglée mais désactivée n'a aucune gamme : elle n'est jamais rangée ailleurs.
- **Corrections DDA** (liste unique) : Nankang = entrée, Nokian = haut. Elles ne servent que si la marque n'est pas dans les réglages.
- **CentralePneus** : catégorie publiée discount / quality / premium, lue comme entrée / milieu / haut. Elle n'est lue qu'en Top prix.
- **Districash** : étiquette BUDGET / MEDIUM / PREMIUM du portail. Si l'étiquette est contradictoire, la gamme est considérée inconnue.
- **Catalogue local** : gamme saisie à la main sur chaque offre.
- **Jamais** de gamme déduite du prix.

## 2. Ordre de priorité
```text
Réglage garage actif  >  marque réglée mais désactivée (= aucune gamme)
  >  correction DDA (Nankang, Nokian)  >  gamme du fournisseur ou du catalogue  >  non classée
```

## 3. Mode classique (un fournisseur choisi)
- Chaque case parcourt les marques réglées pour la gamme, dans l'ordre. La première marque qui a une offre conforme est retenue (la moins chère de cette marque).
- Si aucune marque réglée n'a d'offre, un repli prend une marque non réglée, mais seulement d'après la gamme portée par l'offre.
- Dans ce mode, les corrections Nankang/Nokian ne s'appliquent pas, et la catégorie CentralePneus n'est pas lue. Avec CentralePneus, le repli ne se déclenche donc pratiquement pas. Districash et le catalogue local peuvent, eux, déclencher le repli.

## 4. Top prix
- Toutes les offres de tous les fournisseurs sont mises en commun.
- Chaque offre reçoit sa gamme selon l'ordre de priorité du point 2.
- Le pneu conforme le moins cher l'emporte, quelle que soit la marque.
- L'arrêt de la recherche page par page chez CentralePneus suit la même règle (corrections comprises).

## 5. Marque non classée
- **Top prix :** l'offre est écartée et la marque est signalée dans l'avertissement interne. Ce signalement tient désormais compte des réglages et des corrections.
- **Mode classique :** l'offre est simplement ignorée, sans signalement.
- **Site web :** même moteur que Top prix, et aucune liste de marques n'est envoyée au visiteur.

## 6. Limites et risques
- **Fournisseurs en désaccord :** chaque offre garde la gamme de son fournisseur. La même marque peut donc être en milieu chez CentralePneus et en haut chez Districash. Elle peut alors gagner deux cases, ou une case différente selon le fournisseur le moins cher ce jour-là. Aucun arbitrage n'existe entre fournisseurs. Seuls un réglage garage ou une correction DDA rendent le résultat stable.
- **Catégories qui évoluent :** une catégorie fournisseur peut changer sans prévenir, et la même marque peut changer de case d'un jour à l'autre.
- **Gamme par marque seulement :** le classement se fait par marque, pas par modèle. Une gamme économique d'une marque premium est classée haut.
- **Différences de nom :** la comparaison ignore les majuscules, mais pas les variantes d'écriture (« BF Goodrich » / « BFGoodrich »). Une variante peut sortir non classée ou mal classée.
- **Corrections dans le code :** les corrections DDA ne se modifient pas depuis l'écran. Un réglage garage les remplace.
- **Écart entre les deux modes :** Nankang et Nokian peuvent sortir dans une case différente selon le mode.
- **Catalogue local :** la gamme est saisie à la main, sans contrôle de cohérence avec les réglages du garage.

## 7. Ce qui n'est pas vérifié
- Les catégories réelles de Nankang et Nokian chez CentralePneus et Districash ne sont pas vérifiées.
- Seul Nokian a été vu en « quality » en 205/55 R16. Districash n'a pas été consulté.

## Suites possibles (non engagées)
- Utiliser les corrections DDA aussi en mode classique.
- Tableau interne des marques classées différemment selon le fournisseur.
- Liste de variantes de noms de marques.
