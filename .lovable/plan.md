# Lot correctif Atelier, OR et pneus

## Résultat attendu

- Ajuster uniquement les guides caméra de la bande, du flanc et de la dimension, sans altérer l’image enregistrée.
- Ajouter un vrai démarrage rapide de Tour depuis une plaque ou un OR, sans imposer la création d’un dossier OR.
- Fiabiliser les champs plaque, marque, modèle et remarques client des OR Renault, tout en gardant le pipeline OCR local → règles → IA de secours.
- Donner priorité à `ref_vehicles` pour l’identité véhicule lorsqu’une plaque ou un VIN y existe, sans nettoyage global ni duplication de vérité.
- Remplacer la saisie pneu actuelle du Tour par 3 photos guidées × 4 roues, puis une seule analyse globale après « Terminer ».
- Afficher la progression, permettre la reprise sur erreur, puis faire valider les quatre pneus avec photo annotée et corrections synchronisées avant la clôture.
- Réutiliser le devis pneu existant et ses photos PDF, avec recommandations cohérentes par essieu.

## Mise en œuvre

1. **Caméra et démarrage rapide**
   - Ajuster les tracés U/cercle existants dans la caméra partagée.
   - Distinguer le raccourci « Démarrage rapide » du scan OR complet.
   - Chercher la plaque/OR, réutiliser le véhicule ou l’intervention trouvée, puis créer/reprendre directement le Tour sans OR obligatoire.

2. **Lecture OR et identité véhicule**
   - Renforcer les validateurs purs de plaque, marque et modèle, dont `POLO1O60` → `POLO 1.0 60` seulement lorsque la correction est sûre.
   - Isoler strictement « Remarques du client » jusqu’au prochain bloc et ajouter la régression OR 50985 → `revision`.
   - Résoudre l’identité atelier par plaque/VIN dans `ref_vehicles` avant toute valeur contradictoire de `vehicles`; concaténer proprement gamme et modèle.
   - Ne pas modifier le mécanisme WinMotor existant de récupération complète.

3. **Pneus dans le Tour**
   - Capturer Bande, Flanc et Dimension pour chaque roue, soit 12 photos, sans analyse intermédiaire.
   - Ajouter un appel serveur authentifié unique qui analyse les quatre lots avec Gemini 3.1 Pro et renvoie les quatre résultats normalisés, avec métriques communes.
   - Garder les photos et l’état tant que l’analyse/reprise/validation n’est pas terminée.

4. **Validation, clôture et devis**
   - Intercepter « Terminer » pour afficher une progression estimée jusqu’à réception réelle; désactiver les doubles actions et conserver les photos après erreur.
   - Présenter quatre contrôles réutilisant la photo annotée, le glissement ±0,1 mm et les champs manuels.
   - Enregistrer résultats et corrections dans le Tour et l’historique véhicule, puis seulement clôturer.
   - Calculer la recommandation par essieu/4 pneus avec priorité aux défauts critiques, et transmettre dimensions, quantités et photos au devis existant.

5. **Validation**
   - Ajouter les tests ciblés demandés (guides, raccourci plaque/OR, priorité référentiel, modèle, OR 50985, 12 photos, analyse globale, progression, corrections et essieux).
   - Lancer les tests ciblés, la suite complète et la vérification du code.
   - Contrôler l’écran sur ordinateur; signaler séparément les essais téléphone et appels IA réels non effectués.

## Contraintes maintenues

- Aucun nettoyage massif de `ref_vehicles`.
- Aucun OR officiel créé par DDA.
- Aucun changement des flux commandes/BL ou des droits d’audit.
- Aucune publication.
- Le coût en crédits de ce tour sera rapporté s’il est exposé par les outils; aucun appel IA réel ne sera lancé uniquement pour mesurer le coût.

## Détails techniques

- Les règles métier resteront dans des fonctions pures testées; les appels IA passent par le budget/log existant.
- L’analyse globale peut regrouper quatre analyses de pneu dans une seule action utilisateur et un même suivi, tout en conservant le schéma validé d’« État pneus » par roue.
- Les photos privées seront associées aux enregistrements du Tour existants; aucune image IA ne sera générée.
