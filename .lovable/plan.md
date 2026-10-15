# Étude de faisabilité — commande de pneus Districash depuis DDA Connect v2

Étude uniquement : aucune modification, aucune requête transactionnelle, aucune publication.

## Conclusion courte

- **Faisable techniquement en théorie, non faisable aujourd'hui en autonomie sûre.** Aucune API de commande Districash publique ou documentée n'a été trouvée ni prouvée. `/rest/xat2v2` est un endpoint non documenté, potentiellement transactionnel : il reste interdit.
- **Ce qui existe** : connexion serveur par site, avec formulaire Laravel, CSRF et cookies en mémoire. Elle est complétée par la recherche `POST /search` en lecture seule, l'analyse des lignes J/J+, du prix d'achat portail, de l'EAN et du lien produit direct. Le connecteur bloque explicitement `cart`, `panier`, `checkout`, `order`, `commande`, `/rest/` et `xat2v2` (`districash-session.server.ts`).
- **Recommandation par étapes** :
  1. **Étape 0, sans risque, immédiate** : « commande assistée ». DDA prépare une commande interne et ouvre la fiche produit Districash exacte. L'humain commande sur le portail, puis saisit ou colle la référence de commande Districash dans DDA.
  2. **Étape 1** : l'automatisation complète n'est envisagée qu'après une preuve écrite de Districash/Inoshop, c'est-à-dire une API ou une autorisation d'automatisation, avec un compte ou un environnement de test.

## Code existant réutilisable

- `part_orders` / `part_order_lines` (`src/lib/parts.ts`) : création de commande, fournisseur, rendez-vous, statut, réceptions, rattachement OR et cycle « À pointer ».
- `src/lib/order-duplicate.ts` : détection des commandes similaires (avertissement).
- Réceptions directes et statut OR agrégé (`or-parts-status.ts`).
- Devis pneus : offre retenue avec `supplier_ref`, EAN, `product_url`, prix d'achat HT, disponibilité et date de consultation.
- Identifiants Districash chiffrés par site (`integration_credentials`, `districash:<siteId>`).

## Architecture proposée (étape 0 puis étape 1)

```text
Devis pneus (offre choisie) / OR
      |
      v
[Brouillon commande DDA]  part_orders (fournisseur Districash, site, OR, lignes EAN/réf/qté/PA consulté)
      |
      v
[Revérification lecture seule]  POST /search juste avant -> prix + dispo J/J+ actuels
      |   écart prix/dispo -> blocage + nouvelle validation
      v
[Confirmation humaine explicite]  récapitulatif : site/compte, dépôt, qté, PA, total, OR
      |
      +-- Étape 0 : ouverture fiche produit -> commande manuelle -> saisie n° commande Districash
      +-- Étape 1 (si API prouvée) : envoi serveur unique, clé d'idempotence, journal
      v
[Suivi]  statut commandée -> réception (cycle existant) -> à pointer OR
```

## Prérequis techniques (étape 1 uniquement)

- Documentation officielle du flux panier/commande, avec ses champs, ses réponses et son numéro de commande renvoyé, plus une autorisation écrite d'automatisation.
- Un compte ou un mode de test, ou au minimum une procédure d'annulation connue.
- Une liste blanche de chemins séparée de la lecture seule. Le connecteur actuel reste strictement en lecture.
- Un nouveau droit « commander chez fournisseur », distinct de l'accès au menu, à confirmer avec vous.
- Une table de journal des envois : qui, quand, site, contenu, réponse résumée, sans cookies ni jetons.

## Risques et parades

| Sujet | Risque | Parade |
|---|---|---|
| Authentification | Session expirée, CAPTCHA/MFA futur, blocage du compte | Une tentative par action, arrêt si CAPTCHA/MFA, aucune relance automatique |
| Confirmation humaine | Commande involontaire | Récapitulatif obligatoire et bouton unique de confirmation ; jamais d'envoi depuis le devis client |
| Prix | Le prix à la commande diffère du prix consulté (remises nettes non vérifiées) | Revérification juste avant, blocage si écart, PA consulté conservé |
| Stock / dépôt | J (agence) ou J+ (plateforme) change ; le dépôt de livraison n'est pas connu | Revérification, affichage du dépôt/délai si le portail le fournit, sinon mention « à confirmer » |
| Doublons | Double clic, nouvel essai réseau, deux utilisateurs | Clé d'idempotence par brouillon, verrou de statut, `order-duplicate` existant |
| Compte de site | Commande Lalinde passée sur le compte Castillon (ou l'inverse) | Compte déterminé par le site de l'OR/devis, affiché et vérifié avant envoi |
| Association OR | Pneus non rattachés | OR obligatoire ou choix explicite « stock » ; pas d'OR DDA créé (WinMotor reste la source) |
| Traçabilité | Pas de preuve de commande | N° de commande Districash obligatoire pour passer en « commandée », journal |
| Réponse incertaine | Timeout après envoi : commandé ou non ? | Statut « à vérifier », aucun nouvel envoi automatique, contrôle manuel sur le portail |
| Juridique | Conditions d'utilisation du portail | Accord écrit Districash avant l'étape 1 |

## À vérifier sur le portail, en lecture seule, par un humain dans Chrome

- Les conditions générales et les mentions d'automatisation/API, ainsi qu'un contact technique Inoshop.
- Sur une fiche produit : présence d'un bouton panier, des champs (quantité, dépôt, mode de livraison) et du prix net ou remisé, en observant sans cliquer.
- La page « mes commandes / historique » : format du numéro de commande et statuts visibles. Elle servirait au rapprochement en lecture.
- Le rôle de `/rest/xat2v2`, à demander à Districash. Il ne doit pas être testé.
- La différence de prix entre la liste et la fiche, et la présence d'éventuels frais de port.
- Les dépôts associés aux comptes 19025 (Castillon) et 60669 (Lalinde).

## Estimation indicative

- Étape 0 (commande assistée, réutilisant `part_orders`) : faible à moyenne.
- Étape 1 (envoi automatique) : non estimable sans documentation, car elle dépend entièrement de la réponse de Districash.

## Limites de l'étude

Aucune requête panier ou commande n'a été envoyée et le serveur de Chantal n'a pas été touché. La disponibilité d'une API de commande n'est pas établie.
