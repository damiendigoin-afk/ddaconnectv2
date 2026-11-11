# Pourquoi la section E n'apparaît pas — constat (lecture seule)

## Faits vérifiés
- Le commit **c42b813** (10:25 UTC) contient bien la section E : affichage dans `IxellioPartsDiag.tsx`, calcul dans `ixellio-parts-amounts.ts`, branchement dans `ixellio-parts.server.ts`.
- Rien ne la masque : elle s'affiche dès que la réponse contient `euros`, sans aucun interrupteur ni réglage.
- Le dernier état de compilation ne montre aucune erreur. La bibliothèque ajoutée pour lire les pages est bien déclarée dans le projet.
- Il n'y a aucune publication depuis ces changements : l'adresse publique tourne sur une version antérieure, sans les sections A à E.
- Votre essai affichait A à D, mais ni E ni la phrase « Aucun formulaire… normal pour une page pilotée par JavaScript ». Ces deux éléments ont été ajoutés ensemble dans c42b813.

## Cause la plus probable
L'essai a été fait dans l'aperçu avec la version **63d2136** (10:18), qui contient A à D et pas E. Deux cas possibles :
- l'onglet ou l'aperçu était ouvert avant 10:25 et n'a pas été rechargé ;
- l'essai a été fait pendant la reconstruction de l'aperçu après c42b813, que l'ajout de la bibliothèque rendait plus longue.

Une erreur côté serveur est peu probable : la consultation aurait échoué en entier au lieu de renvoyer A à D.

Non vérifiable ici : l'adresse et l'heure exactes de l'essai, ainsi que le cache du navigateur de l'utilisateur.

## Démarche pour obtenir E avec un seul appel IXELLIO
1. Ouvrir l'**aperçu** (pas l'adresse publique) et le recharger complètement (Ctrl+Maj+R, ou fermer puis rouvrir l'onglet sur téléphone).
2. Avant de consulter IXELLIO, saisir une référence trop courte (3 caractères) : le bouton reste grisé et aucun appel n'est fait. Cela vérifie seulement que la page répond, pas qu'elle est à jour. La seule preuve visible de la bonne version est la présence de la section E après l'appel.
3. Lancer une seule consultation avec 214992066R, hors heures d'atelier.
4. Si E manque encore après un rechargement complet, ne pas relancer IXELLIO. Je vérifierai la version servie par l'aperçu.

## Si vous approuvez
Je peux ajouter un petit marqueur de version, par exemple « diag v3 », affiché sans aucun appel IXELLIO, pour qu'on puisse confirmer la version avant tout essai. Aucune publication.
