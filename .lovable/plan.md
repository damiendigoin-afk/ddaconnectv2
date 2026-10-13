# Diagnostic devis pneus — marge par pneu

## Conclusion
La marge n'est PAS ignorée : ni dans le calcul, ni à l'enregistrement. Elle est bien ajoutée à chaque pneu dans le dernier devis. Je n'ai pas encore comparé l'écran et le PDF ligne par ligne.

## Paramétrage (commercial_settings, ligne unique, tous sites)
- margin_pct = 20 %
- min_margin_ht = 10 € HT par pneu
- tire_mount_price_ht = 17 € HT par pneu
- Lu dans `src/lib/tires.ts` (applyMargin, mountPriceFor), modifiable dans Paramétrage > Chiffrage.

## Formule actuelle (`priceOffer`, src/lib/tires.ts l.713)
```text
base HT      = prix fournisseur ; si prix public TTC (CentralePneus) -> /1,2
marge HT     = MAX(base HT x 20 % ; 10 €)
PV HT/pneu   = base HT + marge
pneus TTC    = PV HT x qté x 1,2
montage TTC  = 17 x qté x 1,2
total TTC    = pneus TTC + montage TTC
```
Levier de marge (adjustOfferMargin) : marge x (1 + levier %), montage inchangé.

## Dernier devis d'aujourd'hui
3c5af2b5-cd03-4428-ae57-2a0dcf013fff — 13/10 15:04, Damien Digoin Automobile, 145/70R13, 2 pneus, levier 0
| Case | Base HT | Marge | PV HT | Pneus TTC | Montage TTC | Total TTC |
|---|---|---|---|---|---|---|
| Imperial été | 40,13 | 10,00 | 50,13 | 120,31 | 40,80 | 161,11 |
| Tracmax 4S | 35,69 | 10,00 | 45,69 | 109,66 | 40,80 | 150,46 |
| Hankook été | 44,58 | 10,00 | 54,58 | 130,99 | 40,80 | 171,79 |
| Hankook 4S | 42,08 | 10,00 | 52,08 | 124,99 | 40,80 | 165,79 |
| Michelin (x2) | indisponible | | | | | |

Devis précédent 1d407f7f (levier +100 %) : la marge est bien doublée à 20 € (et 26,24 / 27,16 sur Michelin, avec 20 % > minimum).

## Pourquoi on peut avoir l'impression qu'il n'y a « pas de marge »
1. **La base n'est pas un vrai prix d'achat** : c'est le prix public TTC de CentralePneus, ramené au HT. Le prix de vente = prix public + 12 € TTC par pneu. Comparé à un tarif fournisseur ou à un site internet, l'écart paraît faible.
2. **Pneus d'entrée/milieu de gamme** : 20 % de 35–45 € = 7–9 €, inférieur au minimum, donc c'est toujours le minimum de 10 € HT qui s'applique.
3. **Pas d'écart selon le type de devis** : le même calcul sert pour le module Devis pneus et pour le Tour véhicule, quel que soit le nombre de pneus. Une seule source de prix est configurée (CentralePneus). Je n'ai donc pas pu vérifier si un autre fournisseur se comporte différemment.

## À confirmer avec l'utilisateur
- Quelle valeur attendait-il : 20 % du prix ? une marge fixe plus élevée ? une marge calculée sur un vrai prix d'achat grossiste, et non sur le prix public ?
- A-t-il vu le problème à l'écran, dans le PDF ou sur la page client ?

## Correctif minimal selon la réponse
- Si c'est le réglage : modifier margin_pct ou min_margin_ht dans Paramétrage, sans toucher au code.
- Si on veut afficher le détail : ajouter « Base / Marge / PV HT » à côté de chaque offre, réservé au personnel (TireOfferGrid). Le PDF client reste inchangé.
- Si l'écran ou le PDF affiche autre chose que les valeurs enregistrées : faire relire l'affichage depuis unitSellHt/tiresTtc (TireQuoteDocument.tsx, tire-quote-pdf.ts).

## Tests à ajouter (tire-margin-lever / tire-provider)
- Base 40,13 HT, 20 % / 10 € -> PV 50,13 HT ; 2 pneus -> pneus 120,31 TTC, montage 40,80, total 161,11.
- Base 65,62 HT -> marge 13,12 (20 % > minimum).
- Le PDF et l'écran affichent le même total TTC que l'offre enregistrée.

## Fichiers concernés
src/lib/tires.ts (applyMargin, sourceHtOf, priceOffer, adjustOfferMargin, mountPriceFor), src/routes/devis.pneus.index.tsx, src/lib/tire-quotes.ts, src/components/TireOfferGrid.tsx, src/components/TireQuoteDocument.tsx, src/lib/tire-quote-pdf.ts, src/routes/parametrage.chiffrage.tsx.
