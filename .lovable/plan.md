# Diagnostic lenteur lecture BL — /pieces-achats/reception (aucune modification)

## Chemin actuel (tout est séquentiel)

```text
photo choisie
 1. compressImage (navigateur) : 1500 px max, JPEG 0,82   ~0,5-2 s
 2. blobToDataUrl (base64, +33 %, ~300-600 Ko)             <0,5 s
 3. localDocText : OCR Tesseract LOCAL sur le téléphone     ~15-40 s (estimé, non mesuré)
    (+ téléchargement moteur/langue au 1er usage, ~10 Mo)
 4. appel serveur ocrPurchaseDocument
    a. règles sur le texte Tesseract
    b. vision Gemini 3.8 Flash (une passe)                  p50 5,3 s
    c. normalisation + contrôles
    d. recheck ciblé si contrôles en échec                  +4-6 s (rare)
 5. uploadSupplierDoc : SHA-256, requête doublon,
    lecture de TOUS les fournisseurs, upload original       ~2-5 s (photo originale non réduite)
 6. affichage DocMatch puis recherche des commandes         ~0,5-1 s
```

## Mesures (journaux)
- Vision `supplier_invoice` (7 j, 81 appels) : médiane 5,3 s ; 50 sous 8 s ; 4 au-dessus de 20 s ; maximum 125 s (cas isolé, 06:05 aujourd'hui, 139 s côté passerelle).
- `supplier_invoice_ids` : 3 appels, ~3 s.
- `supplier_invoice_recheck` : 0 appel journalisé sur 7 j → le recheck n'explique pas la minute.
- Pas de retry automatique : IA = un seul appel ; stockage = au plus 2 reprises (1 s + 3 s) seulement sur 429/503.

## Réponses aux points
- Image envoyée deux fois : oui. Version réduite (base64) pour l'IA, puis original pleine résolution (souvent 3-8 Mo sur Android) vers le stockage, après la lecture.
- Tesseract tourne en plus de la vision sur photo : oui. Il bloque l'attente (il passe avant l'appel serveur), mais le texte est presque inutile en vision-first : les règles ne complètent que les champs vides.
- Recherche commandes : elle attend la lecture + l'upload complets ; elle pourrait commencer dès que fournisseur/réfs sont connus.
- Retours visuels : un seul libellé « Lecture du document… », sans étapes.

## Décomposition estimée d'une minute
Tesseract local 25-40 s · vision 5-8 s (parfois 20 s+) · upload original + fournisseurs 3-8 s · compression/base64 1-2 s · matching ~1 s.
Cause principale probable : l'OCR local sur le téléphone, pas l'IA. À confirmer par une mesure chronométrée (étape 0).

## Plan d'optimisation

### a) Gains faciles et sûrs
0. Ajouter des chronos par étape (console + provenance interne) pour confirmer.
1. Ne plus lancer Tesseract pour les photos en lecture achats (vision-first) ; le garder pour PDF scannés et le mode secours. Gain attendu 15-40 s.
2. Lancer l'upload du document en parallèle de la lecture IA (au lieu d'après).
3. Libellé par étapes : « Photo prise → Envoi → Lecture IA → Contrôles → Recherche commandes ».
Objectif : 6-12 s pour une photo standard.

### b) Gains structurants
4. Si la vision échoue : seulement alors, OCR local en secours (pas systématique).
5. Charger la liste fournisseurs une fois (cache) au lieu de la relire à chaque dépôt.
6. Délai max de 25 s pour la vision, puis « Lecture à vérifier » au lieu d'attendre 2 min.
7. Optionnel : afficher d'abord fournisseur/n° BL, puis lignes et commandes dès qu'elles arrivent.

### c) À ne pas sacrifier
- Vision-first sur photo, contrôles arithmétiques, recheck si incohérent, fail-closed « Lecture à vérifier ».
- Pas d'auto-rattachement fournisseur ni de commande proposée en review.
- Conservation de l'original déposé et anti-doublon SHA-256.
- Pas de baisse de résolution sous 1500 px (lisibilité des références).

## Coût
Lot a) : environ 3-6 crédits. Lot b) : 6-12 crédits. Aucun surcoût IA (moins d'appels si Tesseract retiré).
