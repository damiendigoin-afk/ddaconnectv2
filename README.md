# DDA Connect v2

# DDA CONNECT V2 — PROMPT MAÎTRE

Créer une nouvelle application web mobile-first appelée :

DDA Connect

Damien Digoin Automobile Connect

IMPORTANT :

Il s'agit d'un nouveau projet créé depuis zéro.

DDA Connect a vocation à devenir plus tard une plateforme globale pour l'entreprise, mais cette V2 doit rester concentrée sur un seul module :

TOUR VÉHICULE ATELIER.

Ne pas développer pour l'instant les futurs modules RH, congés, notes de frais, productivité, marketing, etc.

L'architecture doit néanmoins rester propre, modulaire et évolutive.

==================================================

1 — OBJECTIF DE DDA CONNECT V2

==================================================

Créer une application principalement utilisée sur smartphone par les opérateurs d'un garage automobile :

- mécaniciens

- carrossiers

- réceptionnaires

- apprentis

Parcours principal :

ORDRE DE RÉPARATION

→ identification du véhicule

→ choix Tour Libre ou Tour Guidé

→ contrôles

→ photos

→ observations

→ kilométrage

→ validation

→ historique

→ rapport

→ lien partageable

L'application doit privilégier :

- rapidité

- simplicité

- gros boutons

- très peu de saisie

- utilisation mobile

- sauvegarde permanente

- aucune perte de données

- fonctionnement possible même si les fonctions OCR échouent.

Une fonction automatique ne doit JAMAIS empêcher l'opérateur de continuer manuellement.

==================================================

2 — SUPABASE

==================================================

Utiliser Supabase pour :

- base de données

- stockage des médias

- persistance des données

Toutes les données doivent rester présentes après fermeture et réouverture de l'application.

Les Tours Véhicule commencés mais non terminés doivent être sauvegardés comme brouillons.

Ne jamais stocker les images directement dans les tables SQL.

Utiliser Supabase Storage.

Prévoir une table générique "media" compatible à terme avec :

- photo

- video

- audio

Dans cette V2, seule la PHOTO doit être activée.

==================================================

3 — ACCUEIL

==================================================

Créer un accueil très simple.

Afficher :

DDA CONNECT

Tour Véhicule

Bouton principal :

+ NOUVEL OR

Puis :

RECHERCHER

Permettre recherche par :

- immatriculation

- numéro OR

- nom client

Afficher ensuite :

OR RÉCENTS

Chaque carte doit montrer :

- immatriculation en gros

- marque + modèle

- numéro OR

- date OR

- nom du client

Un clic ouvre la fiche OR.

==================================================

4 — CRÉATION D'UN OR

==================================================

Proposer deux possibilités :

1. SCANNER / PHOTOGRAPHIER UN OR

2. SAISIE MANUELLE

L'OCR ne doit jamais être obligatoire.

==================================================

5 — OCR ORDRE DE RÉPARATION

==================================================

Permettre :

- photographie depuis le smartphone

- import d'une photo

- import d'un PDF

Analyser le document par OCR.

Essayer d'extraire les données suivantes.

CLIENT :

- numéro compte client

- nom

- prénom

- adresse

- complément adresse

- code postal

- ville

- téléphone

- téléphone mobile si disponible

- email

VÉHICULE :

- immatriculation

- VIN

- marque

- modèle / gamme / version

- kilométrage

- date de première mise en circulation

ORDRE DE RÉPARATION :

- numéro OR

- date OR

- remarques client

- travaux à prévoir / travaux demandés

- date/heure entrée si disponible

- date/heure restitution si disponible

IMPORTANT :

L'OCR ne doit jamais créer automatiquement le dossier sans validation.

Après analyse afficher :

"VÉRIFIER LES INFORMATIONS DÉTECTÉES"

Tous les champs doivent être modifiables.

Afficher visuellement les champs que l'OCR considère comme incertains si cette information est disponible.

Bouton final :

VALIDER ET CRÉER L'OR

Conserver également le document OR original dans les médias du dossier.

Si OCR impossible :

permettre immédiatement la saisie manuelle.

==================================================

6 — IDENTIFICATION PAR PLAQUE

==================================================

Ajouter depuis l'accueil :

SCANNER UNE PLAQUE

Utiliser l'appareil photo du smartphone.

Détecter l'immatriculation.

Normaliser automatiquement :

hh-405-dn

HH405DN

hh405dn

doivent être considérés comme :

HH-405-DN / HH405DN

Chercher ensuite le véhicule ou l'OR correspondant.

Si trouvé :

afficher immédiatement la fiche.

Si plusieurs OR correspondent :

afficher les OR les plus récents.

Si aucune correspondance :

proposer :

- corriger l'immatriculation détectée

- rechercher manuellement

- créer un nouvel OR

IMPORTANT :

Le scan plaque ne doit jamais être bloquant.

==================================================

7 — FICHE OR

==================================================

Afficher clairement :

IMMATRICULATION

Marque + modèle

Kilométrage actuel connu

N° OR

Date OR

Client

Travaux prévus

Remarques client

Permettre d'afficher les informations détaillées client et véhicule sans surcharger l'écran principal.

==================================================

8 — HISTORIQUE DES TOURS VÉHICULE

==================================================

Ceci est IMPORTANT.

Ne jamais afficher uniquement :

"4 Tours Véhicule"

sans pouvoir les consulter.

Créer une vraie section :

TOURS VÉHICULE

Afficher chaque tour individuellement.

Exemple :

15/08/2026 — 14:32

TOUR GUIDÉ

Terminé

12 zones

24 photos

14/08/2026 — 10:14

TOUR LIBRE

Terminé

3 défauts

5 photos

15/08/2026 — 15:10

TOUR GUIDÉ

BROUILLON

Zone 4/12

Chaque tour doit être cliquable.

Afficher :

- date

- heure

- type Libre/Guidé

- statut

- progression

- kilométrage du véhicule lors du contrôle si disponible

- nombre d'observations

- nombre de photos

==================================================

9 — CYCLE DE VIE D'UN TOUR

==================================================

Statuts minimum :

draft

completed

Lorsqu'un utilisateur clique sur :

TOUR LIBRE

ou

TOUR GUIDÉ

le tour peut être créé en brouillon.

Un tour brouillon doit pouvoir :

- être repris

- être consulté

- être supprimé

Ajouter :

SUPPRIMER CE BROUILLON

avec confirmation.

Un Tour terminé ne doit pas pouvoir être supprimé accidentellement.

==================================================

10 — SAUVEGARDE AUTOMATIQUE

==================================================

Ceci est CRITIQUE.

Chaque action doit être sauvegardée progressivement.

Exemples :

- statut d'un point

- commentaire

- mesure

- photo

- zone terminée

- progression

Si l'utilisateur ferme l'application à la zone 4/12 :

lorsqu'il revient il doit voir :

TOUR GUIDÉ EN COURS

Zone 4/12

REPRENDRE LE TOUR

Il doit retrouver toutes ses données.

==================================================

11 — NAVIGATION PENDANT LE TOUR

==================================================

L'utilisateur ne doit JAMAIS être enfermé dans le Tour Véhicule.

Pendant un Tour afficher une navigation permettant :

RETOUR À L'OR

ou

QUITTER LE TOUR

Cela ne doit pas supprimer le tour.

Afficher par exemple :

"Tour sauvegardé en brouillon."

L'utilisateur doit ensuite pouvoir le reprendre.

==================================================

12 — CHOIX DU TOUR

==================================================

Sur la fiche OR :

DÉMARRER UN TOUR VÉHICULE

Deux gros boutons :

TOUR LIBRE

"Signaler uniquement les défauts constatés"

TOUR GUIDÉ

"Effectuer le contrôle étape par étape"

Aucune gestion de profils pour l'instant.

==================================================

13 — TOUR LIBRE

==================================================

Le Tour Libre doit être extrêmement rapide.

Bouton principal :

+ SIGNALER UN DÉFAUT

Catégories :

- Pneus / roues

- Freinage

- Éclairage

- Pare-brise / vitrage

- Essuie-glaces

- Batterie

- Niveaux

- Mécanique

- Carrosserie

- Autre

Puis sélectionner l'élément précis.

Pour chaque observation :

STATUT :

- À surveiller

- Défaut / à remplacer

MESURE :

facultative

avec valeur + unité.

COMMENTAIRE :

facultatif.

PHOTOS :

0, 1 ou plusieurs.

Puis :

ENREGISTRER

Afficher ensuite les défauts déjà créés.

Permettre de les rouvrir et les modifier avant clôture.

Bouton :

TERMINER LE TOUR

==================================================

14 — TOUR GUIDÉ

==================================================

Le Tour Guidé doit guider physiquement l'opérateur autour du véhicule.

PRINCIPE ABSOLU :

UNE POSITION PHYSIQUE = TOUS LES CONTRÔLES POSSIBLES À CET ENDROIT.

Ne pas organiser :

4 pneus

puis 4 jantes

puis 4 freins

car cela oblige à refaire plusieurs fois le tour du véhicule.

Ordre :

1. départ côté conducteur

2. avant gauche

3. face avant

4. avant droit

5. côté droit

6. arrière droit

7. arrière du véhicule

8. arrière gauche

9. côté gauche

10. habitacle

11. sous capot

12. sous véhicule / véhicule sur pont

Afficher :

ZONE X / 12

et clairement la position.

Exemple :

ZONE 2 / 12

AVANT GAUCHE

==================================================

15 — CONTRÔLES D'UNE ZONE

==================================================

Exemple AVANT GAUCHE :

PNEU AVG

- OK

- À surveiller

- Défaut

Profondeur :

___ mm

JANTE / ENJOLIVEUR AVG

- OK

- À surveiller

- Défaut

FREIN AVG

- OK

- À surveiller

- Défaut

ÉLÉMENTS VISIBLES

- OK

- À surveiller

- Défaut

Pour CHAQUE point permettre :

- statut

- mesure si pertinente

- commentaire

- plusieurs photos

IMPORTANT :

Une photo peut être ajoutée même si le contrôle est OK.

Exemple :

un apprenti peut photographier un pneu neuf afin de conserver une trace du contrôle.

==================================================

16 — NE PAS BLOQUER LE TOUR GUIDÉ

==================================================

Le Tour Guidé doit guider mais ne doit pas empêcher le travail.

Il doit être possible de passer à la zone suivante même si tous les points n'ont pas été renseignés.

Les points non contrôlés doivent rester identifiables comme :

NON RENSEIGNÉ

Ne jamais transformer automatiquement un point non renseigné en OK.

==================================================

17 — DÉPLACEMENT ENTRE ZONES

==================================================

À la fin d'une zone afficher :

AVANT GAUCHE TERMINÉ

Passez maintenant devant le véhicule.

CONTINUER

Permettre également :

ZONE PRÉCÉDENTE

afin de corriger une saisie.

==================================================

18 — HABITACLE ET COMPTEUR

==================================================

Dans la zone HABITACLE ajouter un contrôle spécifique :

KILOMÉTRAGE

Proposer :

PHOTOGRAPHIER LE COMPTEUR

Utiliser réellement l'appareil photo sur mobile.

Conserver la photo.

Analyser la photo par OCR pour détecter le kilométrage.

Exemple :

Kilométrage détecté :

78 452 km

Afficher :

CONFIRMER

ou

MODIFIER

L'opérateur doit toujours valider la valeur.

Si OCR impossible :

permettre saisie manuelle.

Une fois validé :

- enregistrer le kilométrage dans le Tour Véhicule

- mettre à jour le dernier kilométrage connu dans DDA Connect

- conserver la photo comme preuve

Ne jamais écraser silencieusement une valeur.

Conserver l'historique des kilométrages.

Créer une alerte si le nouveau kilométrage est inférieur au kilométrage précédent.

Ne pas bloquer : demander confirmation.

==================================================

19 — SOUS CAPOT

==================================================

Regrouper les contrôles accessibles sous capot :

- huile

- liquide refroidissement

- liquide frein

- lave-glace

- batterie

- fuites visibles

- état général

- autres contrôles pertinents

Toujours :

OK / À surveiller / Défaut

+ mesure éventuelle

+ commentaire

+ photos

==================================================

20 — VÉHICULE SUR PONT

==================================================

Dernière zone :

SOUS VÉHICULE / SUR PONT

Regrouper notamment :

- soufflets transmission

- flexibles

- fuites

- échappement

- trains roulants

- suspension

- direction

- éléments de freinage accessibles

- sous caisse

Toujours organiser les contrôles afin de limiter les déplacements.

==================================================

21 — PHOTOS : CORRIGER LE COMPORTEMENT MOBILE

==================================================

IMPORTANT :

Créer DEUX actions réellement différentes :

PRENDRE UNE PHOTO

et

GALERIE

Sur smartphone :

PRENDRE UNE PHOTO doit ouvrir directement l'appareil photo / caméra arrière si le navigateur le permet.

GALERIE doit ouvrir le sélecteur de fichiers/photos.

Ne pas faire pointer les deux boutons vers exactement le même sélecteur générique si la plateforme permet de les différencier.

Permettre :

- plusieurs photos

- miniatures

- visualisation

- suppression avant validation

==================================================

22 — COMPRESSION DES PHOTOS

==================================================

Conserver toutes les photos.

Compresser/redimensionner avant stockage.

Objectif indicatif :

1200 à 1600 pixels sur le plus grand côté.

Qualité suffisante pour voir :

- usure pneu

- fissure

- fuite

- plaquette

- carrosserie

- compteur

Ne jamais supprimer automatiquement les médias d'un Tour validé.

==================================================

23 — FIN DU TOUR

==================================================

Afficher un résumé.

Pour Tour Guidé :

TOUR VÉHICULE TERMINÉ

Exemple :

18 points contrôlés

12 OK

3 À surveiller

2 Défauts

1 Non renseigné

27 photos

Afficher les anomalies.

Permettre :

MODIFIER

puis :

VALIDER ET TERMINER LE TOUR

Une fois validé :

status = completed

Pour Tour Libre :

ne jamais dire que les éléments non signalés ont été contrôlés.

Afficher seulement :

3 défauts signalés

5 photos

==================================================

24 — CONSULTATION D'UN TOUR TERMINÉ

==================================================

Depuis l'historique de la fiche OR :

un Tour terminé doit être consultable à tout moment.

Afficher :

- date/heure

- type

- kilométrage

- toutes les zones

- tous les contrôles

- statuts

- mesures

- commentaires

- photos

Permettre une vue synthétique et une vue détaillée.

==================================================

25 — RAPPORT

==================================================

Un Tour terminé doit permettre :

VOIR LE RAPPORT

Le rapport atelier conserve TOUT :

- OK

- À surveiller

- Défauts

- non renseignés

- mesures

- commentaires

- photos

==================================================

26 — LIEN PARTAGEABLE

==================================================

Créer une page web partageable pour un Tour terminé.

Boutons :

APERÇU DU LIEN CLIENT

COPIER LE LIEN

Aucun envoi automatique de SMS ou d'email.

Le personnel copie manuellement le lien dans son logiciel habituel.

Pour le rapport partageable, privilégier les éléments :

- À surveiller

- Défauts

- photos correspondantes

- commentaires utiles

Ne pas nécessairement afficher toutes les photos des contrôles OK au client.

Les photos restent néanmoins conservées dans le dossier atelier.

==================================================

27 — STRUCTURE DES MÉDIAS

==================================================

Créer une table media générique.

Prévoir notamment :

id

inspection_id

inspection_point_id

observation_id

media_type

storage_path

created_at

media_type doit permettre :

photo

video

audio

Dans cette V2 :

activer uniquement photo.

==================================================

28 — HISTORIQUE KILOMÉTRIQUE

==================================================

Ne pas seulement stocker "dernier_km".

Prévoir un historique.

Chaque relevé doit pouvoir conserver :

- véhicule

- kilométrage

- date/heure

- origine

- Tour Véhicule associé

- photo compteur éventuelle

Cela permettra plus tard de comparer l'évolution.

==================================================

29 — PRÉPARATION FUTURE DES MISES À JOUR DMS

==================================================

Ne PAS développer d'intégration Winmotor dans cette V2.

Mais prévoir que certaines informations saisies dans DDA Connect pourront plus tard générer automatiquement une "proposition de mise à jour DMS".

Exemple :

ancien kilométrage :

76 500 km

nouveau kilométrage contrôlé :

78 452 km

DDA Connect pourra plus tard signaler :

"Kilométrage à reporter dans Winmotor."

L'opérateur qui réalise le Tour ne doit faire AUCUNE action supplémentaire.

La proposition doit être générée automatiquement en arrière-plan.

Ne pas développer encore l'interface complète de cette fonction.

Simplement ne pas concevoir la base d'une manière qui empêcherait cette évolution.

==================================================

30 — STRUCTURE DE DONNÉES

==================================================

Prévoir au minimum :

clients

vehicles

repair_orders

vehicle_inspections

inspection_points

observations

media

mileage_history

Relations :

Client

→ véhicule

→ OR

→ Tours Véhicule

→ points/observations

→ médias

IMPORTANT :

Un client peut avoir plusieurs véhicules.

Un véhicule peut avoir plusieurs OR.

Un véhicule peut changer de propriétaire dans le futur.

Un OR peut avoir plusieurs Tours Véhicule.

Un Tour peut être draft ou completed.

==================================================

31 — CHARTE GRAPHIQUE

==================================================

Créer une identité professionnelle inspirée de l'univers Renault atelier.

IMPORTANT :

Ne pas copier une application Renault existante.

Créer une identité DDA Connect propre.

Direction graphique :

- fond principalement blanc / gris très clair

- textes noirs / anthracite

- touches de jaune Renault pour les actions importantes

- design moderne

- très lisible

- professionnel

- sobre

- grandes zones tactiles

- adapté aux smartphones

- contraste élevé

Utiliser le jaune avec modération pour les boutons/actions importantes.

Les statuts métier doivent rester immédiatement identifiables :

OK

À surveiller

Défaut

L'interface doit ressembler davantage à un outil atelier moderne qu'à un logiciel administratif.

==================================================

32 — MOBILE FIRST

==================================================

Concevoir d'abord pour smartphone.

Tester les écrans sur une largeur mobile.

Les boutons doivent être suffisamment grands pour être utilisés rapidement dans un atelier.

Limiter les menus complexes.

Limiter la saisie clavier.

Toujours privilégier :

bouton

photo

sélection

mesure rapide

avant texte libre.

==================================================

33 — NE PAS DÉVELOPPER POUR LE MOMENT

==================================================

Ne pas développer :

- SMS

- email automatique

- paiement

- devis automatique

- signature électronique

- acceptation client complexe

- vidéo

- audio

- modules RH

- congés

- notes de frais

- productivité

- gestion complexe des utilisateurs

- connexion bidirectionnelle Winmotor

- marketing

- module vendeur

- DMS complet

==================================================

34 — ARCHITECTURE FUTURE

==================================================

DDA Connect ne doit PAS être conçu comme une simple "application Tour Véhicule".

Le Tour Véhicule est le PREMIER MODULE d'une future plateforme DDA Connect.

À terme, DDA Connect pourra contenir d'autres modules pour :

- atelier

- réception

- vente

- administration

- RH

- management

- marketing

Ne pas développer ces modules maintenant.

Simplement garder une architecture permettant de les ajouter ultérieurement.

==================================================

35 — PRIORITÉ ABSOLUE

==================================================

La V2 doit avant tout permettre de tester réellement sur smartphone :

1. créer/scanner un OR

2. valider l'OCR

3. retrouver un OR

4. éventuellement scanner une plaque

5. démarrer un Tour Libre ou Guidé

6. ajouter contrôles, mesures, commentaires et photos

7. photographier le compteur et détecter le kilométrage

8. quitter le Tour sans perdre les données

9. reprendre un brouillon exactement là où il était

10. terminer le Tour

11. retrouver ce Tour dans l'historique

12. le consulter

13. générer son rapport

14. copier un lien partageable

NE PAS sacrifier la fiabilité de ces fonctions pour ajouter des fonctionnalités supplémentaires.

Si une fonction OCR ou caméra ne peut pas fonctionner correctement sans configuration/API supplémentaire, construire l'interface et le fallback manuel proprement et indiquer clairement ce qui reste à connecter, plutôt que de simuler une fonctionnalité qui ne fonctionne pas réellement.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://ddaconnectv2.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/fb7b13a3-0362-4023-ab5a-40c0904e11b3).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
