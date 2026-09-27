# Lignes visibles dans Commandes et Réceptions

## Objectif
- Afficher immédiatement les lignes OCR éditables sous l’état de la commande.
- Détailler toutes les pièces dans chaque commande en attente, sans résumé caché.
- Ouvrir une commande directement sur ses lignes restantes à réceptionner.
- Préserver les repères OR DDA, dossier WinMotor et plaque existants.

## Mise en œuvre
- Créer une présentation compacte commune pour les lignes de commande, adaptée ordinateur/mobile.
- En saisie OCR, remplacer les blocs verticaux par une grille éditable référence, désignation, quantité et PA HT.
- En listes d’attente, afficher référence, désignation, commandé, déjà reçu, reliquat et PA HT pour chaque ligne.
- À la réception, préremplir toutes les lignes non soldées et afficher séparément commandé, déjà reçu et reçu maintenant, avec alertes en ligne et contrôle individuel.
- Ajouter des fonctions pures et tests pour les lignes OCR, les listes multi-lignes et les reliquats partiels.

## Vérification et livraison
- Vérifier les écrans ordinateur et mobile dans l’aperçu.
- Exécuter les tests ciblés et complets, puis contrôler le code et la construction.
- Publier la version validée sur ddaconnectv2.lovable.app et confirmer le commit réellement déployé.

## Hors périmètre
- Aucun changement dans Notes de frais ou Tour véhicule.
- Aucun changement des règles de stock ou du rapprochement final WinMotor.
