# Refonte du tableau de bord DDA Connect

## Objectif

Transformer uniquement la page d’accueil en tableau de bord atelier clair, mobile-first et orienté action, tout en conservant les routes, droits, données et fonctions existantes.

## Structure cible

```text
┌──────────────────────────────────────────────────────────────────────┐
│ DDA CONNECT          Site : Lalinde / Groupe       Bonjour, Damien  │
│ [TABLEAU DE BORD]                                 [Profil] [Quitter] │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────┐  ┌───────────────────────────────────┐
│ Bonjour Damien               │  │ AUJOURD’HUI                       │
│ Pilotez l’activité de        │  │ 12 Tours   3 Expertise   4 Docs │
│ l’atelier en un coup d’œil.  │  │ Récents / Alertes / Messages     │
└──────────────────────────────┘  └───────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ Rechercher une immatriculation, un OR, un client, un fournisseur…  │
└──────────────────────────────────────────────────────────────────────┘

                         [ DÉMARRER UN TOUR ]

┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Tour véhicule│ │ Expertise    │ │ Carrosserie  │ │ Magasin      │
│ ● 5 en cours │ │ ● 2 brouillon│ │ ● 3 nouvelles│ │ ● 6 à traiter│
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Factures     │ │ Statistiques │ │ Communication│ │ Paramètres   │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘

Barre mobile fixe : Accueil · Recherche · + · Notifications · Plus
```

## Mise en œuvre

1. **En-tête applicatif**
   - Remplacer l’en-tête actuel de l’accueil par une barre blanche compacte : marque DDA Connect à gauche, badge site alimenté par le contexte de site existant, nom de l’utilisateur, accès profil et déconnexion à droite.
   - Ajouter l’onglet actif « Tableau de bord » avec soulignement jaune, sans créer de nouvelle navigation métier.

2. **Bandeau d’accueil et activité du jour**
   - Ajouter un bandeau gris très clair avec la salutation personnalisée et le texte d’accompagnement demandé.
   - Afficher trois KPI compacts et lisibles avec icônes : Tours véhicule, Expertises, Documents à traiter.
   - Ajouter les blocs secondaires « Récents », « Alertes » et « Messages » en réutilisant les données déjà disponibles lorsque possible ; aucun nouveau schéma ni changement backend.

3. **Recherche et action principale**
   - Conserver `UniversalSearch` et l’intégrer comme large barre centrale avec icône loupe et placeholder élargi aux fournisseurs.
   - Ajouter le bouton jaune « Démarrer un tour » pointant vers le parcours Tour Véhicule existant.

4. **Grille des modules**
   - Remplacer la liste verticale par une grille de huit tuiles : Tour véhicule, Expertise véhicule, Carrosserie, Magasin, Factures fournisseur, Mes statistiques, Communication, Paramètres.
   - Conserver les contrôles de droits existants et masquer les tuiles non autorisées, notamment Paramètres pour les non-managers.
   - Utiliser des icônes contour, titres courts, sous-titres métier, bordures fines, ombres discrètes et rayons modérés.
   - Afficher les statuts utiles sous forme de puces quand une donnée existante fiable est disponible ; éviter tout compteur fictif.

5. **Navigation mobile**
   - Ajouter sur l’accueil une barre basse fixe à cinq entrées : Accueil, Recherche, bouton central jaune « + », Notifications, Plus.
   - Relier chaque action à un comportement existant : retour accueil, focus de la recherche, accès au Tour Véhicule, zone alertes/messages, et accès aux modules complémentaires.
   - Prévoir les espacements de sécurité mobile pour ne jamais masquer le contenu.

6. **Direction visuelle et responsive**
   - Étendre les tokens existants vers une palette claire blanche/gris doux, jaune Renault en accent, noir et gris foncé pour la hiérarchie.
   - Desktop : largeur généreuse, bandeau en deux zones et grille sur quatre colonnes.
   - Tablette : grille sur deux colonnes.
   - Mobile : empilement lisible, cartes sur une ou deux colonnes selon largeur, barre basse toujours accessible, aucune coupure de texte.
   - Ajouter uniquement des transitions discrètes et respecter la réduction des animations.

## Fichiers prévus

- `src/routes/index.tsx` : nouvelle composition du tableau de bord et branchement aux données/contexte existants.
- `src/styles.css` : ajustements ciblés des tokens et utilitaires globaux nécessaires à la direction visuelle.
- Éventuellement un petit composant dédié sous `src/components/` si la barre mobile ou les tuiles rendent la route trop volumineuse.

## Vérifications

- Contrôler les rôles manager/salarié et l’absence de liens vers des routes inexistantes.
- Vérifier visuellement les largeurs mobile, tablette et desktop, ainsi que la barre basse et l’absence de chevauchement.
- Vérifier les états avec/sans compteurs et alertes, le focus de recherche, le CTA et la déconnexion.
- Exécuter typecheck, suite de tests et build, puis lire le dernier rapport de build.

## Hors périmètre

- Aucun changement de schéma, migration, authentification, fonction serveur ou logique métier.
- Aucun redesign des pages internes.
- Aucun compteur inventé ni nouvelle source de données.
- Aucune publication automatique.
