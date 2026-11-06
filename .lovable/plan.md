# Diagnostic — devis POIRIE GH965GW (WEST LAKE 1956515HZ401XL)

Lecture seule. Rien n'a été modifié.

## Ce qui a été démontré
- Devis 2a6a72b1 créé le 02/11/2026 10:05 UTC, 195/65R15 95H, quantité 2, offre WEST LAKE : `unitSourceHt` 40,80, `marginHt` 10, `unitSellHt` 50,80, `consultedAt` 2026-11-02, disponibilité J+.
- Les 6 offres Districash de ce devis ont des prix d'achat différents (41,53 / 40,80 / 59,22 / 59,85 / 64,03 / 84,16). Le moteur n'a donc pas copié une même valeur partout.
- **Ce n'est pas le montage.** `mountTtc` = 40,80 sur toutes les offres = 17,00 HT × 2 pneus × 1,20 (`mountPriceFor`, `src/lib/tires.ts` l. 631-640). Il est ajouté après coup dans `priceTireLine` (l. 659-678) et n'entre jamais dans `unitSourceHt` (`sourceHtOf`, l. 617-621). Le fait que les deux valent 40,80 est une coïncidence.
- Chemin du prix : `parseDistricashSearch` lit uniquement l'attribut HTML `data-filtreprixachat` de la ligne produit (`src/lib/districash.ts` l. 155), puis `districashRowsToOffers` le transmet tel quel en `purchase_price_ht` avec `price_kind: "purchase_ht"` (l. 252-253). Aucune remise, aucun PV, aucune écotaxe ni aucun « PA net » n'est lu. Il n'y a pas de cache Districash (pas de cache dans `districash*.ts` ni dans `tire-provider.server.ts`) : le prix vient de la recherche faite au moment du devis.
- Historique de cette marque/modèle : le prix relevé varie d'un jour à l'autre (42,60 → 45,98 → 51,21 → 40,80 entre le 15/10 et le 02/11). Les références de ces anciens devis restent à confirmer une par une.

## Cause probable (hypothèse, non prouvée)
Le 02/11, la valeur `data-filtreprixachat` affichée par le portail valait 40,80. Le portail ne garde pas la page lue et on ne peut pas la relire après coup. Deux explications restent possibles :
1. **Le prix a changé** entre le 02/11 et la commande du 04/11 (prix promotionnel ou de liste plus bas ce jour-là). C'est cohérent avec les fortes variations observées.
2. **Cet attribut n'est pas le PA net facturé** : prix « filtre » ou de liste, différent du prix net calculé au panier (60,08). L'écart de 19,28 € (+47 %) dépasse une simple écotaxe.

Le code n'a pas mal lu ou mal calculé : il a fidèlement repris la valeur du portail. Un ancien PA est donc possible (hypothèse 1). Un PA d'une autre nature l'est aussi (hypothèse 2).

## Autres devis exposés
Tous les devis Districash reposent sur le même attribut. Si l'hypothèse 2 est vraie, ils sont tous potentiellement sous-évalués. Si c'est l'hypothèse 1, seuls les devis émis pendant une baisse temporaire sont concernés.

## Vérifications proposées (avant tout correctif)
1. Sur le portail, relever le même jour, pour la même référence, le prix de recherche (`data-filtreprixachat`), le prix de la fiche produit et le prix au panier.
2. Comparer les devis Districash récents avec les factures et réceptions réelles, par référence et par date.
3. Selon le résultat : lire le prix net (fiche ou panier) au lieu de l'attribut de filtre, ou afficher un avertissement « prix à reconfirmer » avant la commande. Ce correctif ne sera fait que sur votre accord.
