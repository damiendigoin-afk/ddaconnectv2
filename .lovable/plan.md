# Plan technique — « Commander chez DC » automatisé (connecteur transactionnel Districash)

Étude uniquement. Aucune requête vers /cart/store, /cart/order, /cart/payment ou /order/registered n'a été ni ne sera envoyée par ce plan. Aucune commande n'a été passée. Le serveur de Chantal n'est pas touché et rien n'est publié.

## 1. Point de départ (existant)

- Le bouton « Commander chez DC » (`TireOrderDialog.tsx`) crée une commande interne `part_orders` au statut `to_transmit`. Il ouvre ensuite la fiche produit pour une validation manuelle.
- La commande passe à `ordered` uniquement avec un n° fournisseur réel (`confirmSupplierOrder` + trigger SQL `guard_part_order_transmit`).
- `transmission_mode` vaut `manual`. La place est déjà réservée pour un mode `connector`.
- Le connecteur `districash-session.server.ts` fonctionne en lecture seule. Il bloque `cart`, `order`, `commande`, `/rest/` et `xat2v2`, et ce blocage reste en place.

## 2. Protocole observé (lecture du JS par l'utilisateur, non exécuté par DDA)

```text
POST /cart/store      -> JSON {nb_added, price_total, agence, cart id}   (panier, pas une commande)
POST /cart/order      -> JSON : error_message | no_redirect | async_order | succès
                         succès: order.data.{Cde_rel, Cde_std, Cde_depot}, order.date
                         headers X-CSRF-TOKEN (meta), dataType json
POST /order/registered -> navigation (order_date, articles_rel/std/dep, pk_cfg_dis_plateformes, async_order=1)
POST /cart/payment    -> mode paiement (si attribut payment) : HORS PÉRIMÈTRE
```

Payload `/cart/order` : code_agence, code_fournisseur, code_regroupement, code_transporteur, livre_par_transpo, lib_transporteur, frais_de_port, date_livraison, not_in, commentaire, article_commentaire, reference (OR), immatriculation, expedition/expedition_label, type, adresse_1..3, departement, ville, pays, telephone, raison_sociale, bureau_distributeur, code_postal, code_adresse.

## 3. Architecture cible

```text
Devis pneus -> [Brouillon DDA to_transmit]  (existant)
   |
   v
[Préparation serveur] login site -> /search revalidation (prix, J/J+, agence) -> écart = blocage
   |
   v
[Récapitulatif obligatoire] compte 19025/60669, agence, transporteur, frais de port,
   date livraison, adresse livraison, qté, PA, total, OR/immat -> case + bouton unique
   |
   v
[Envoi unique] verrou statut 'sending' + clé d'idempotence
   /cart/store (panier vidé/contrôlé) -> /cart/order (sans paiement uniquement)
   |
   +-- succès avec Cde_* -> 'ordered', n° fournisseur = Cde_* , journal
   +-- error_message / no_redirect -> 'send_failed', rien d'autre
   +-- async_order / timeout / réponse inconnue -> 'to_verify' : AUCUN renvoi auto,
       contrôle humain sur l'historique portail puis saisie manuelle du n°
   v
[Pièces & achats] réception BL, pointage OR, bon de commande DDA (PDF interne)
```

### Composants

- `src/lib/districash-order.server.ts` est un module séparé du connecteur de lecture. Il a sa propre liste blanche de 2 chemins seulement (`/cart/store`, `/cart/order`) et le même hôte exact. Il est désactivé par défaut avec un drapeau de site `order_automation_enabled=false`.
- `src/lib/districash-order.ts` regroupe les règles pures : construction du payload, analyse de la réponse en union stricte (`success | error | no_redirect | async | unknown`), comparaison prix/dispo et clé d'idempotence.
- Server functions authentifiées (`requireSupabaseAuth`) :
  - `prepareDistricashOrder` : revalidation et récapitulatif. Aucune écriture fournisseur.
  - `sendDistricashOrder` : envoi effectif.
- La modale garde l'étape 0 (manuelle) par défaut. Le mode automatique n'apparaît que si le site est activé et que l'utilisateur a le droit.

### Base de données (migration additive)

- `part_orders` : nouveaux statuts `sending`, `send_failed`, `to_verify`, avec `idempotency_key` unique, `supplier_cart_id`, `supplier_order_refs jsonb` (rel/std/dep) et `supplier_order_date`.
- Nouvelle table `supplier_order_attempts` : order_id, user, site, compte, payload résumé sans secrets, statut HTTP, réponse résumée, durée et issue. Elle est protégée par RLS par site et en ajout seul.
- `tire_supplier_site_settings` : `order_automation_enabled`, avec le transporteur et l'adresse de livraison par défaut à confirmer.
- Le trigger existant est étendu : `ordered` exige toujours un n° réel, qu'il soit saisi ou issu de `Cde_*`.

## 4. Protections

| Sujet | Mesure |
|---|---|
| Confirmation humaine | Récapitulatif plus case à cocher et bouton unique ; jamais d'envoi depuis le devis client ni en masse |
| Prix / stock / dépôt | /search juste avant l'envoi ; blocage si le PA ou la dispo J/J+ change, ou si l'agence diffère ; le total panier `price_total` est comparé avant /cart/order |
| Compte de site | Identifiants du site de la commande uniquement ; compte affiché et revérifié côté serveur |
| OR / immat | Au moins un des deux est obligatoire ; `reference` = OR WinMotor, `immatriculation` est normalisée ; aucun OR DDA n'est créé |
| Doublons | Verrou SQL `to_transmit -> sending` atomique ; clé d'idempotence ; contrôle des doublons existant ; double clic neutralisé |
| Panier | Le panier portail est vérifié vide avant ajout, sinon blocage, pour ne pas commander les articles d'un autre utilisateur ; `not_in` n'est jamais utilisé pour masquer |
| Timeout inconnu | Statut `to_verify`, aucun nouvel essai automatique ; rapprochement manuel via l'historique portail |
| Paiement | `/cart/payment` est interdit ; si l'attribut payment est présent, l'envoi est bloqué |
| /order/registered | Non appelé au départ (page de navigation), à confirmer |
| Secrets | Cookies/CSRF en mémoire uniquement, jamais journalisés ni renvoyés |
| Droit | Nouveau droit « Commander chez fournisseur » distinct de l'accès au menu, à valider par vous |
| PDF client | Aucun prix d'achat ni fournisseur (règles existantes inchangées) |

## 5. Points du protocole NON confirmés

1. **Réponse réelle de /cart/order** : le JSON exact n'a jamais été observé. On ne connaît pas les types, ni lequel de Cde_rel, Cde_std ou Cde_depot est rempli pour une commande agence ou plateforme, ni le code HTTP en cas d'erreur.
2. **Sens d'`async_order`** : on ne sait pas si la commande est créée ou seulement mise en file, ni comment obtenir ensuite son numéro.
3. **/order/registered** : on ne sait pas s'il ne sert qu'à l'affichage ou s'il finalise et enregistre quelque chose. C'est bloquant pour savoir s'il faut l'appeler.
4. **Origine des champs du payload** : code_agence, code_fournisseur, code_regroupement, code_transporteur, frais_de_port, date_livraison, code_adresse et bureau_distributeur. On ne sait pas d'où ils viennent (page panier HTML ?), ni s'ils sont propres au compte 19025 ou 60669.
5. **Comportement du panier** : panier partagé entre utilisateurs du même compte, persistance, vidage. Le panier observé (cart 8747596, 2 Sailun, 81,84 €, agence BRIV) existe peut-être encore sur le compte et doit être vidé manuellement par un humain.
6. **Prix** : on ne sait pas si `price_total` est net HT remisé, ni si des frais de port s'ajoutent.
7. **Annulation** : aucune procédure connue après un envoi.
8. **Autorisation d'automatisation** : aucune CGU ni accord écrit Districash/Inoshop. C'est un **prérequis bloquant** avant tout envoi réel.
9. **Environnement de test** : aucun.

## 6. Étapes

1. **Lot A (sans risque)** : règles pures, analyseur de réponse sur des réponses synthétiques, migration, journal, récapitulatif, statuts `to_verify`/`send_failed`. Envoi désactivé dans le code (aucune route réseau transactionnelle active).
2. **Lot B** : bon de commande fournisseur PDF interne et réconciliation dans Pièces & achats (n° Cde_* ou saisie manuelle, rattachement BL).
3. **Lot C (bloqué)** : activation du module d'envoi seulement après l'accord écrit Districash, l'observation d'une vraie réponse /cart/order et la clarification de /order/registered. Il démarre par une première commande réelle unique, décidée explicitement par vous, sur un seul site.

## Détails techniques

- La liste noire de lecture (`districash-session.server.ts`) reste inchangée. Le module d'envoi importe le cookie jar via une fonction dédiée et ne réutilise jamais la liste blanche de lecture.
- Tests : construction du payload (OR/immat, compte site), analyse des 5 issues, verrou d'idempotence, blocage en cas d'écart prix/dispo, blocage si le panier n'est pas vide, interdiction de payment/registered/xat2v2, et trigger `ordered` sans n° refusé.
