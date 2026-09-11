# Devis pneus 205/55R16 91V — pourquoi seul Kleber est chiffré

## Diagnostic (vérifié en direct sur le site fournisseur)

La consultation du fournisseur a été relancée telle qu'elle est faite aujourd'hui, sur l'adresse
`https://www.centralepneus.fr/pneu-auto-205-55-16/`.

Résultat réel :
- réponse correcte (200), page complète reçue ;
- 59 pneus lus, sur les 1 519 annoncés par le fournisseur pour cette dimension ;
- marques obtenues : Hankook, Dunlop, Kumho, Kleber, Keter, Rotalla, Nereus, Kpatos, Greentrac,
  Mazzini, Forceland, Dovroad, Saferich, Lanvigator, Kustone, Rauffan, Blackarrow, Landspider,
  Sonix, Trazano, Nexen, Tracmax, Tomket, Aplus, Uniroyal ;
- Michelin et Sailun n'apparaissent nulle part dans les prix de cette page : ils n'existent que
  dans la liste déroulante des filtres de marque.

**Cause racine : la pagination.** Le fournisseur n'affiche que la première page de résultats
(les moins chers d'abord). Kleber y figure, Michelin et Sailun non. Nous ne lisons donc jamais
leurs prix, alors qu'ils existent bien.

Ce n'est donc :
- ni un filtrage par notre lecture (les produits ne sont pas dans la page) ;
- ni du chargement différé/JavaScript (les prix de la page 1 sont bien dans la page reçue) ;
- ni un besoin d'indices charge/vitesse (l'adresse avec « 91v » renvoie une page inexistante).

Vérifications complémentaires faites :
- page 2 (`?p=2`) : 50 pneus, dont 4 Michelin et 1 Sailun ;
- filtre marque Michelin : 39 produits ;
- filtre marque Sailun : 27 produits.

Conclusion : les marques présélectionnées sont disponibles, mais hors de la seule page que nous
consultons. L'affichage « indisponible » est donc exact vis-à-vis de ce que nous lisons, et faux
vis-à-vis de la réalité du fournisseur.

## Correction proposée (à valider, non appliquée)

Interroger le fournisseur **par marque attendue** plutôt qu'une seule page générique :
pour chaque gamme (entrée / milieu / haut) et pour la marque éventuellement demandée, appeler
l'adresse filtrée sur cette marque, puis fusionner les résultats avant le chiffrage habituel.

Détails techniques :
- `src/lib/tire-provider.server.ts` : ajouter la construction d'URL avec filtre marque
  (`?brands[]=<id>`), une table de correspondance marque → identifiant fournisseur (lisible depuis
  la page de dimension, où chaque marque porte son identifiant), et une consultation en parallèle
  limitée aux marques réellement nécessaires ; conserver la lecture actuelle en repli.
- `src/lib/tire-provider.functions.ts` : passer la liste de marques attendues à la consultation.
- Aucun changement du moteur de chiffrage partagé, du paramétrage global ni des Tours Véhicule.
- Tests : marque présente hors première page → offre chiffrée ; marque réellement absente de la
  dimension → toujours « indisponible », sans substitution.
