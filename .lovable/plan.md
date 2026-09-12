# Audit sécurité — alertes « données d'activité » (lecture seule)

Aucun code, aucune migration, aucune donnée n'a été modifié. Ce document est un rapport.

## 1. Alertes en cours (5 au total, dont 2 critiques)

| # | Alerte | Sévérité | Objet |
|---|--------|----------|-------|
| 1 | Toute personne connectée peut lire, modifier ou supprimer les données d'activité mensuelles | Critique | table `activity_months` |
| 2 | Toute personne connectée peut lire, modifier ou supprimer les valeurs d'indicateurs | Critique | table `activity_values` |
| 3 | Toute personne connectée peut lire/modifier l'historique des imports | Avertissement | table `activity_imports` |
| 4 | Toute personne connectée peut lire/modifier les visuels publicitaires | Avertissement | table `ad_assets` |
| 5 | Codes journaux internes lisibles par toute personne connectée | Avertissement | table `winmotor_journals` |

Alerte technique séparée (non liée à l'activité) : plusieurs fonctions internes de la base sont exécutables par les comptes connectés (avertissement, signalé par le contrôleur de la base). Aucun stockage de fichiers (bucket) n'est concerné.

## 2. Données exposées

- `activity_months` : société (`dda` / `castillon`), mois, onglet source, statut (provisoire/définitif), date de mise à jour.
- `activity_values` : toutes les valeurs d'indicateurs mensuels — chiffre d'affaires, marges, volumes, heures, etc.
- `activity_imports` : nom du fichier importé, nom et identifiant de l'importateur, nombre de mois/valeurs, anomalies détectées.
- `ad_assets` : visuels et textes publicitaires.
- `winmotor_journals` : codes journaux comptables internes.

## 3. Qui peut faire quoi aujourd'hui

- Les règles d'accès de ces tables sont écrites en « toujours vrai » pour le rôle « connecté » : lecture, insertion, modification et (pour les mois et valeurs) suppression sont ouvertes à **n'importe quel compte authentifié**, sans vérification de compte actif, de rôle ni de société.
- Les visiteurs non connectés n'ont **aucun** accès : aucune règle ne les autorise.
- État réel des comptes : 24 profils, tous actifs ; 7 managers et 17 salariés, aucun compte « client ».
- Comparaison avec le reste du projet : Productivité, Sites, etc. exigent `is_active_user()` en lecture et le rôle manager en écriture. Les tables d'activité sont donc l'exception.

## 4. Scénario de risque concret

Un salarié sans aucun droit sur le module Statistiques, ou un compte désactivé plus tard mais dont l'authentification reste valide, peut depuis un simple appel à l'API : lire l'intégralité du chiffre d'affaires et des marges des deux sociétés, modifier une valeur mensuelle, ou supprimer des mois entiers. La perte serait silencieuse (pas de journal sur ces tables) et ne se verrait qu'à la consultation des tableaux de bord.

## 5. Exploitable réellement ou théorique ?

Réellement exploitable, mais uniquement par une personne **déjà connectée** à DDA Connect. Dans l'application, l'accès à l'écran Statistiques est filtré par les droits modules, donc l'exposition n'est pas visible dans l'interface ; le contournement se fait hors interface, avec la clé publique de l'application et un compte valide. Risque externe anonyme : nul. Risque interne : réel, aggravé par la suppression possible.

## 6. Correctif minimal recommandé (non appliqué)

Aligner ces 5 tables sur le modèle déjà utilisé ailleurs, par simple remplacement des règles d'accès (aucun changement de schéma, aucune donnée touchée) :

- Lecture : réservée aux comptes actifs (`is_active_user(auth.uid())`).
- Création / modification des mois, valeurs et imports : comptes actifs (l'import passe par la fonction `activity_import_apply`, qui s'exécute avec les droits de l'appelant — les imports continuent donc de fonctionner).
- Suppression des mois et valeurs : réservée aux managers.
- `ad_assets` : lecture/écriture comptes actifs, suppression déjà réservée aux managers.
- `winmotor_journals` : lecture comptes actifs.

Option plus stricte possible ultérieurement : restreindre l'écriture d'activité aux seuls managers ou aux détenteurs du droit « Import statistiques ». À valider avec vous, car cela changerait qui peut importer.

## 7. Impact fonctionnel attendu

Aucun pour les 24 comptes actuels, tous actifs : Statistiques, Productivité, Tours, Activité et l'import Excel continuent de fonctionner à l'identique. Seule différence visible : un compte désactivé ne verrait plus ces données, et la suppression de mois deviendrait réservée aux managers.

## Suite

Ce rapport est purement un diagnostic. Dites-moi si vous voulez que je prépare le correctif (variante standard ou variante stricte) ; rien ne sera modifié sans votre accord.
