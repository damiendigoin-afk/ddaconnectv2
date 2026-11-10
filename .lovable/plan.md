# Diagnostic lecture seule — 1re MEC HG-714-NQ (OR 17413)

Aucune modification de code, données, configuration ; aucune publication.

## Étapes
1. Lire en base (SELECT uniquement) la fiche véhicule HG-714-NQ / VIN VF1RHN00774040932 : first_registration, delivery_date, source_system, dates de mise à jour, et le journal du scan OR lié (OR 17413).
2. Télécharger en mémoire temporaire (/tmp) l'objet privé `or-scans/92f38b10-.../4c0581e9-....jpg` via un accès serveur en lecture, puis lire visuellement la case « 1re MEC » (zoom sur la zone). Fichier supprimé ensuite.
3. Si la photo est inaccessible ou illisible : appeler une seule fois `runIxellioWithStoredCredentials` / `lookupIxellioVehicle` sur HG-714-NQ (lecture seule, aucune écriture), restituer dateMec et VIN renvoyés.
4. Comparer avec 2026-07-18 et indiquer la cause probable (confusion OCR, ex. date d'OR/livraison), en distinguant constaté vs supposé.

## Rendu
- Éléments réellement consultés, valeurs exactes, incertitudes.
- Aucune correction de la fiche sans votre feu vert.
