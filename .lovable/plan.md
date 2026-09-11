# Devis 195/55R16 87H — pourquoi « Haut de gamme · 4 saisons » est vide en Michelin

## Ce qui a été exécuté (consultation réelle, sans rien modifier)

Consultation telle qu'elle existe aujourd'hui, dimension 195/55R16, marque ciblée Michelin :
50 produits lus au total, dont **3 Michelin, tous en été** :

| Saison | Modèle | Dimension | Charge | Vitesse | Référence | Prix TTC |
|---|---|---|---|---|---|---|
| Été | E Primacy | 195/55R16 | 91 | H | tyre1678242 | 73,99 € |
| Été | Primacy 4 | 195/55R16 | 87 | H | tyre1803075 | 73,99 € |
| Été | E Primacy | 195/55R16 | 91 | H | tyre1249003 | 112,57 € |

Aucun Michelin 4 saisons n'arrive donc jusqu'au chiffrage.

## Ce que le fournisseur propose réellement

En interrogeant la page filtrée sur la marque Michelin (adresse déjà connue de l'application),
**33 Michelin** reviennent, dont **8 en 4 saisons** :

| Modèle | Dimension | Charge | Vitesse | Référence | Prix TTC |
|---|---|---|---|---|---|
| CrossClimate 2 | 195/55R16 | 87 | H | tyre1179161 | 96,91 € |
| CrossClimate 2 | 195/55R16 | 87 | V | tyre1179162 | 96,82 € |
| CrossClimate 2 | 195/55R16 | 91 | H | tyre1707409 | 100,32 € |
| CrossClimate 2 | 195/55R16 | 91 | V | tyre1182151 | 100,91 € |
| CrossClimate 3 | 195/55R16 | 87 | H | tyre1909470 | 104,41 € |
| CrossClimate 3 | 195/55R16 | 87 | V | tyre1909465 | 97,91 € |
| CrossClimate 3 | 195/55R16 | 91 | H | tyre1910971 | 101,57 € |
| CrossClimate 3 | 195/55R16 | 91 | V | tyre1909483 | 100,32 € |

Un CrossClimate 2 en 87 H existe donc bien, exactement à l'indice demandé.

## Cause racine

Ce n'est **ni** une absence réelle, **ni** un problème de lecture de la saison (les CrossClimate
sont correctement lus « 4 saisons »), **ni** un filtre charge/vitesse (le moteur ne filtre que sur
la dimension, pas sur 87H).

La cause est dans la **condition qui déclenche la consultation par marque** :
l'application ne consulte la page filtrée d'une marque que si cette marque est **totalement
absente** de la première page de la dimension. Michelin y figure — avec trois produits été
seulement — donc l'application considère Michelin « déjà obtenu » et n'interroge jamais sa page
complète. Les Michelin 4 saisons ne sont jamais lus, et le créneau « Haut de gamme · 4 saisons »
s'affiche « indisponible dans cette marque ».

Le contrôle est fait par marque, alors qu'il devrait l'être **par marque et par saison** (été et
4 saisons étant deux créneaux distincts à chiffrer).

## Correction envisagée (non appliquée)

Dans la consultation fournisseur (`src/lib/tire-provider.server.ts`) : remplacer le test
« marque déjà présente » par « marque présente **pour chaque saison nécessaire** ». Si une marque
attendue n'a aucun produit dans l'une des saisons chiffrées, consulter sa page filtrée et
fusionner comme aujourd'hui. Aucune autre logique ne change : pas de nouvelle source, pas de
modification des marges, du montage, des gammes, ni du moteur partagé avec les Tours Véhicule.
Une marque réellement absente doit rester « indisponible », sans substitution.

Tests à ajouter : marque présente en été mais pas en 4 saisons sur la première page → l'offre
4 saisons est bien chiffrée ; marque réellement absente → toujours indisponible.
