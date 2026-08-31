# Correctif ciblé — PDF officiel et notification Front Office

## Diagnostic confirmé

- La clôture passe bien par `finishTour` → `closeTour` → `notifyTourCompleted`.
- Le destinataire est résolu depuis le paramétrage Front Office avec la règle existante : destinataires du site du Tour + destinataires globaux.
- Le PDF joint est généré séparément du PDF affiché à l’écran. En cas d’échec de génération, le code actuel continue pourtant l’envoi sans pièce jointe et peut marquer la notification comme envoyée.
- Le flux Front Office journalise seulement dans l’historique du Tour, jamais dans `email_logs` ; les envois Front Office récents sont donc absents du journal demandé.
- La clé d’idempotence contient l’heure courante et ne protège donc pas réellement les relances automatiques.
- Le destinataire actuellement configuré est bien rattaché à Castillon. Les Tours Lalinde/DDA n’ont actuellement aucun destinataire propre ou global et doivent rester signalés comme non envoyés.

## Modifications

1. **Logo PDF officiel**
   - Conserver l’asset exact `dda-renault-logo.jpeg.asset.json` déjà utilisé dans le PDF écran/impression.
   - Utiliser ce même asset dans le PDF serveur joint à l’e-mail Front Office, sans recréer le logo.

2. **Envoi Front Office fiable**
   - Exiger un PDF généré, non vide et correspondant à l’identifiant du Tour avant tout appel au fournisseur d’e-mail.
   - Si le PDF ou le logo ne peut pas être généré, arrêter l’envoi et enregistrer un échec explicite ; ne plus envoyer un message prétendant contenir un PDF absent.
   - Garder la résolution multi-site existante et échouer explicitement quand aucun destinataire ne correspond au site.
   - Utiliser une clé d’idempotence stable pour la clôture automatique afin d’empêcher les doublons réels ; conserver la relance manuelle comme une nouvelle tentative explicite.

3. **Traçabilité exacte**
   - Créer une ligne `email_logs` par destinataire Front Office avant l’appel fournisseur.
   - Passer à `sent` uniquement lorsque le fournisseur accepte la requête et renvoie un identifiant ; sinon enregistrer `failed` avec le message d’erreur.
   - Aligner l’historique `tour_notifications` sur les résultats réels : succès, échec total ou succès partiel, sans horodatage d’envoi en cas d’échec total.

4. **Tests ciblés**
   - Ajouter des tests sans envoi réel couvrant : résolution/dédoublonnage des destinataires, pièce jointe PDF obligatoire, acceptation fournisseur avec identifiant, refus fournisseur, et agrégation succès/échec.
   - Vérifier le PDF produit par sa signature, son nombre de pages et son contenu lié au Tour.
   - Exécuter les tests concernés et laisser le build automatique confirmer le typecheck/build.

## Périmètre

Fichiers ciblés : PDF Tour, notification Front Office, expéditeur serveur et tests associés. Aucun changement du flux d’envoi client, du module mails entrants, ni ajout d’IA ou de migration.
