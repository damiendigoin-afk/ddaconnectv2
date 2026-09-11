# Diagnostic — devis 205/55R16 91V : Michelin été absent, Sailun proposé en 91H

Consultations réelles effectuées chez le fournisseur, marque par marque. Aucun fichier modifié.

## 1. Pourquoi Michelin été est « indisponible » alors que Michelin 4 saisons est trouvé

Sur la page générale de la dimension (la seule consultée quand une marque y figure déjà),
**un seul Michelin apparaît : un CrossClimate 2 94 V, 4 saisons.**

L'application ne va chercher la page complète d'une marque que si cette marque est **totalement
absente** de cette première page. Michelin y étant présent (par ce seul produit 4 saisons),
la consultation complète Michelin n'est jamais lancée : aucun Michelin été n'entre dans le
chiffrage, et le créneau été s'affiche « indisponible ».

Sailun, lui, est **absent** de cette première page : sa page complète est donc consultée, d'où
27 produits Sailun disponibles. Kleber apparaît partiellement (4 produits) — même angle mort que
Michelin.

C'est exactement la même cause que le cas 195/55R16 déjà diagnostiqué : le contrôle se fait
par marque, alors qu'il devrait se faire **par marque et par saison**.

## 2. Pourquoi Sailun est proposé en 91 H alors que la demande est 91 V

Le moteur de chiffrage ne filtre **que sur la dimension**. Les indices de charge et de vitesse
demandés sont affichés sur le devis mais **ne servent à aucun filtrage** : pour chaque gamme et
chaque saison, il retient simplement le produit le moins cher de la marque.

Résultat : Sailun été = Atrezzo Elite 91 H à 42,16 € (le moins cher), Sailun 4 saisons =
Atrezzo 4Seasons 91 H à 47,91 €, alors que des 91 V existent. Ce n'est pas un défaut de lecture
des indices (ils sont correctement lus), c'est l'absence de règle de conformité charge/vitesse.

## 3. Des versions 91 V existent-elles ? Oui, sauf un cas

| Marque | Été | 4 saisons |
|---|---|---|
| Michelin | Primacy 4+ **91 V** 66,49 € · Primacy 5 91 V 71,91 € · E Primacy 91 V 71,91 € | CrossClimate 3 **91 V** 79,82 € · CrossClimate 2 91 V 78,82–102,49 € |
| Sailun | Atrezzo Elite **91 V** 45,57 € · Atrezzo Elite 2 91 V 48,99 € | **aucun 91 V** — seulement 91 H, et 94 V (charge et vitesse supérieures) |
| Kleber | Dynaxer HP5 **91 V** 58,83 € · Dynaxer HP4 91 V 72,99 € | Quadraxer 3 **91 V** 66,49 € |

Des indices supérieurs (94 V, 91 W, 91 Y) existent aussi partout et restent conformes.
Le seul cas nécessitant un arbitrage est **Sailun 4 saisons**, où le choix se fait entre un
91 H (vitesse inférieure) et un 94 V (conforme, légèrement plus cher : 47,99 €).

## 4. Le marquage 3PMSF est-il exposé par le fournisseur ?

Oui, mais **pas dans un champ dédié** : il figure uniquement dans le libellé du produit
(ex. « Michelin CrossClimate 3 205/55 R16 91V 3PMSF »). Il est donc lisible de façon fiable.

Relevé réel sur les 4 saisons de la dimension :
- Michelin : 11 produits, **tous marqués 3PMSF** ;
- Kleber : 3 produits, **tous marqués 3PMSF** ;
- Sailun : 7 produits, **6 marqués 3PMSF**, 1 non marqué (Atrezzo 4Seasons 94 V, réf. tyre1912635).

La règle métier « 4 saisons certifié hiver → indice de vitesse inférieur toléré » est donc
applicable, à condition de lire le marquage dans le libellé et non dans un champ structuré.
Les champs techniques du fournisseur (catégories internes) ne portent pas cette information :
ils indiquent seulement la saison et un niveau de gamme (premium / quality / discount).

## Synthèse des trois causes distinctes

1. Consultation par marque déclenchée trop rarement → Michelin (et Kleber) incomplets.
2. Aucun contrôle charge/vitesse dans la sélection → 91 H retenu pour une demande 91 V.
3. Marquage 3PMSF disponible mais non exploité → aucune tolérance hiver possible aujourd'hui.

Aucune correction n'a été appliquée. Ces trois points peuvent être traités ensemble dans une
passe ciblée sur la consultation fournisseur et la règle de sélection, sans toucher au moteur de
marge, au montage ni au paramétrage global.
