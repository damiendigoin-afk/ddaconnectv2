# Correction générique du flux « Commander des pièces »

## Objectif
Fiabiliser la lecture des PDF achats structurés sans ajouter de règle propre à OSKARBI ou Renault, et garantir que les données lues arrivent réellement dans le formulaire.

## Mise en œuvre
1. **Chaîne réelle** — tracer le texte natif du PDF, les règles déterministes, la normalisation serveur et l’initialisation du formulaire ; supprimer tout mapping qui perd fournisseur, lignes ou prix.
2. **Parseur générique** — lire les articles par blocs délimités par référence, puis rattacher désignation, quantité et prix selon leurs libellés (« Prix client », « PU », « PA »), même si les colonnes PDF sont désalignées.
3. **Informations du document** — rechercher fournisseur et alias sur tout le document, prioriser la date de commande explicite, conserver commande, plaque, repères OR multiples, port et totaux.
4. **Validation métier** — calculer une qualité d’achat couvrant commande, date, fournisseur, repères et lignes ; un OR/date seuls ou des références visibles avec zéro ligne déclencheront le repli prévu ou une erreur claire, jamais un faux succès.
5. **Formulaire** — conserver les pièces et ajouter le port comme ligne « Frais », maintenir la saisie PA HT virgule/point et le lien privé vers le PDF source.
6. **Vérification** — ajouter les deux fixtures exactes demandées, conserver AUTODOC/RETRO/multi-OR, lancer les tests ciblés puis complets et vérifier à l’écran les champs réellement préremplis.

## Résultats attendus
- OSKARBI/Pièce Auto Discount 2887082 : date 2026-09-29, OR 17072, pièce 5571201 à 43,10 €, port 12,90 €, total 56,00 €.
- Renault Parts 45965672 : DC-354-ZH, OR 16533, deux pièces à 56,33 € et 125,69 € ; 41,12 € et 109,35 € exclus des PA.
- Aucun changement de données et aucune publication.

## Détails techniques
Les règles resteront déterministes et communes. Le PDF natif restera prioritaire ; les sorties IA seront normalisées par la même validation métier avant d’être appliquées au formulaire.
