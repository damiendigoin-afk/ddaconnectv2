# IXELLIO — conclusion sur le « temps Remplacer » (analyse, sans nouvelle version)

## Conclusion
Les deux scripts publics et la section L réelle ne contiennent **aucune durée de main-d'oeuvre lisible pour « Remplacer »** sur la page de recherche. Aucune nouvelle version du diagnostic n'est utile. Rien ne prouve encore qu'il s'agisse d'un temps constructeur.

## Ce que montre le code (fonction par fonction)
- **selectPiece** : si le champ `pieceCodeElement_<id>` de la ligne est vide, la pièce est sélectionnée « par référence » seule (`listeIdReferenceSelect`), sans popup ni donnée d'intervention. S'il est rempli, elle appelle **menuInterventions**.
- **menuInterventions** : choisit une liste d'interventions (mécanique, carrosserie, carrosserie sans peinture) selon le type, puis appelle **afficheMenuIntervention**. Ces listes sont remplies par la page. Le script ne contient aucune durée.
- **afficheMenuIntervention / autoSelectIntervention** : construisent les cases à cocher. Remplacer correspond au code AA3. « OK » appelle **valideInterventions**.
- **valideInterventions** : aucun appel réseau. Elle enregistre les codes cochés dans `pieceInterventions_<id>`, colore la ligne en orange et affiche des blocs masqués. Elle affiche `divTempsRemplacement_` seulement si Redresser ou Réparer est coché, jamais pour Remplacer seul. La section L réelle n'a trouvé **aucun** de ces blocs.
- **buildPiece** : lit l'entrée `pieceRechercheItems.get(id)` (un tableau fourni par la page) et n'y écrit que 4 cases : codes d'intervention, catégorie peinture, quantité, franchise. Aucune case « temps » n'est lue ni écrite.
- **buildTempsRedressage / checkRedressage** : seuls endroits qui lisent un « temps » : `pieceTempsRedressage_`, `pieceTempsReparation_` et les taux associés. Ce sont des **valeurs saisies par le garage en carrosserie**, contrôlées comme nombres positifs, sans unité. Ce ne sont pas des temps constructeur.
- **Le mot « Remplacer »** n'est lié à aucune durée dans les scripts. Les seuls « Temps » du code sont ceux de la carrosserie : redressage et réparation.

## 2 enregistrements de pièce pour 3 lignes
`pieceRechercheItems.put` est écrit dans la page, pas dans les scripts. D'après **selectPiece**, seules les lignes qui ont un code élément utilisent ces données. L'explication la plus cohérente est donc **2 lignes avec code élément (popup) et 1 ligne en sélection par référence seule**. Non confirmé : il faudrait compter les `pieceCodeElement_` remplis.

## Enregistrer = modifier IXELLIO
- **saveSelectionToChiffrage** : envoie le formulaire avec l'action `addToChiffrage` (ajout à un chiffrage existant). C'est une modification.
- **saveSelectionToNewChiffrage** : `addToNewChiffrage`, crée un chiffrage. C'est une modification.
- **saveSelection** : envoie la sélection à la page chiffrage pièce avec l'action `redirect`, puis ouvre `Chiffrage.html?method=edit`. C'est une modification probable.

Les minutes de remplacement que décrit le gérant apparaissent donc très probablement **dans l'écran de chiffrage, calculées par IXELLIO après l'ajout**. Atteindre cet écran modifie un chiffrage : DDA ne doit jamais le faire automatiquement.

## Une seule prochaine action
Demander au gérant **une capture IXELLIO, faite par lui-même dans IXELLIO, à l'endroit exact où les minutes de « Remplacer » s'affichent**. L'en-tête de l'écran et le titre de la colonne (unité) doivent être visibles. Deux cas :
- **Les minutes apparaissent juste après « OK »**, sans quitter la liste : alors elles ne viennent pas des scripts publics. Il faudrait comprendre d'où, avant tout développement.
- **Elles n'apparaissent qu'après « Ajouter au chiffrage »**, sur un chiffrage de test : alors la source est l'écran Chiffrage. Il faudra décider avec le gérant si une lecture de cet écran est acceptable. Aujourd'hui elle est exclue, car elle modifie IXELLIO.

Aucun nouveau test des boutons DDA n'est demandé d'ici là.

## Seule piste sans requête supplémentaire (non recommandée pour l'instant)
On pourrait décrire la **forme** des tableaux `pieceRechercheItems.put` déjà reçus : nombre de cases, et pour chaque case vide, nombre ou texte, sans aucune valeur. Les cases écrites par buildPiece (codes, catégorie peinture, quantité, franchise) seraient marquées comme connues.
- Confiance faible : une case numérique sans libellé ni unité ne prouve pas une durée.
- Aucune requête, aucun clic, aucune écriture.
- À ne faire que si la capture montre les minutes dès le « OK », sans passer par le chiffrage.

## Hors périmètre
Pas de publication, pas d'appel IXELLIO connecté, pas d'enregistrement, aucun TM présenté comme récupéré.
