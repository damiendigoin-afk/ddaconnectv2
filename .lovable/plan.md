# DDA Connect v2.7 — Correctifs consolidés

## Objectif
Corriger les parcours ciblés sans refondre les modules v2.6 : import Suivi Missions en priorité, périodes de productivité, cohérence photo/caméra, contrôle technique intégré au Tour Véhicule et chronométrage persistant.

## 1. Import Suivi Missions — correction à la source
- Renforcer la lecture Excel/CSV pour détecter la vraie feuille et la vraie ligne d’en-tête, y compris les cellules fusionnées, espaces insécables et variantes `Immat`, `Immat.`, `N° Immatriculation`.
- Transporter explicitement pour chaque ligne : colonne détectée, valeur brute, valeur nettoyée, valeur normalisée et valeur enregistrée ; afficher ces étapes dans le diagnostic d’import et les conserver dans la trace de ligne.
- Séparer la plaque lisible de la clé normalisée : conserver le format source/lisible sur le véhicule et utiliser `AB123CD` uniquement pour recherche et dédoublonnage.
- Rendre la création/récupération du véhicule obligatoire avant la mission : ne plus masquer une erreur de référentiel, rattacher systématiquement `ref_vehicle_id`, et ne créer la mission qu’avec une plaque non vide.
- Limiter le formulaire manuel aux lignes dont la cellule est réellement vide ou introuvable, puis réimporter uniquement les lignes corrigées.
- Ajouter des tests de parsing/mapping pour XLSX et CSV avec plusieurs variantes d’en-têtes et trois plaques différentes.

## 2. Productivité
- Conserver le sélecteur existant avec navigation immédiate mois précédent/suivant.
- Borner les périodes à 12 mois consécutifs et empêcher les périodes inversées.
- Garder le dernier mois complet comme valeur initiale.
- Vérifier l’agrégation sur les sommes d’heures, puis recalculer productivité et rentabilité sur les totaux, dans les vues personnelle et équipe.

## 3. Photos et Expertise
- Uniformiser l’action de prise de vue avec l’icône caméra dans Expertise et les contrôles concernés.
- Garder la prise directe comme action principale, sans choix préalable ; l’analyse automatique classe/extrait, la saisie manuelle reste un secours.
- Préserver les originaux HD et les miniatures ; vérifier l’ouverture plein écran/zoom depuis chaque galerie et rapport.
- Sécuriser le compteur : enregistrer la photo avant OCR, préremplir la valeur, permettre la correction et conserver le lien photo–kilométrage même si l’analyse échoue.

## 4. Contrôle technique dans la Face avant
- Ajouter un point « Contrôle technique » à côté du pare-brise et des balais avant, avec le bouton caméra standard.
- Ajouter une analyse OCR spécialisée retournant deux champs indépendants : échéance CT périodique et échéance pollution, sans choisir arbitrairement la première date.
- Afficher les dates détectées dans le point, permettre leur correction, conserver la photo source et les métadonnées de lecture/correction.
- Mettre à jour la fiche véhicule avec les deux échéances et leur provenance afin qu’elles restent réutilisables hors du Tour.

## 5. Chronométrage persistant
- Modifier le modèle du Tour pour distinguer création du brouillon et démarrage réel : `started_at` devient renseigné uniquement via « Démarrer le Tour Véhicule ».
- À la validation finale, enregistrer atomiquement fin, durée calculée, opérateur et type de contrôle ; conserver ces données lors d’une reprise ou d’un rafraîchissement.
- Afficher opérateur, début, fin et durée dans le rapport terminé et la fiche véhicule.

## Migration de données
- Étendre la fiche véhicule avec l’échéance pollution et les métadonnées de source/lecture/correction CT.
- Étendre le Tour avec une fin explicite et, si nécessaire, rendre le début nullable pour respecter le démarrage réel.
- Étendre les points de contrôle avec les deux dates CT et leurs métadonnées, sans modifier les anciens tours.
- Conserver les règles d’accès actuelles et les droits existants.

## Recette obligatoire
- Importer un vrai XLSX contenant `AB-123-CD`, `GR-456-EF`, `FG-789-HI`, puis contrôler en base les trois véhicules, les trois missions, leurs rattachements et l’absence de plaque nulle ; tester aussi une ligne réellement vide corrigée sans recommencer le fichier.
- Tester navigation mensuelle, période multi-mois, limite de 12 mois, dernier mois complet et ratios recalculés.
- Tester caméra, stockage HD, miniature zoomable et compteur avec OCR réussi puis échoué.
- Tester CT classique puis VU à deux dates, correction manuelle et mise à jour de la fiche véhicule.
- Tester création sans démarrage, démarrage explicite, sortie/reprise, finalisation, durée persistée et affichage du rapport.
- Vérifier le build, les erreurs navigateur et les parcours mobile.
