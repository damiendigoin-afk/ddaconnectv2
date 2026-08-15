# Module Base de Données — Import Winmotor

Ajout d'un module Manager "Base de données" à DDA Connect : import d'exports Winmotor (CSV `;` / CP1252 ou XLSX), référentiel Clients / Véhicules enrichi, recherche universelle, fiches client & véhicule. Aucun module existant (Tour, Expertise, OCR, rapports, Resend) n'est modifié dans son fonctionnement.

## 1. Base de données

Nouvelles tables (toutes avec `site_id`, RLS, GRANTs) :

- `customers` — référentiel client : `source_system`, `source_customer_id`, civilité, nom, prénom, raison sociale, type (particulier/entreprise), SIRET/SIREN/TVA, champs normalisés (`last_name_normalized`, `first_name_normalized`, `company_normalized`).
- `customer_contacts` — `type` (EMAIL/MOBILE/PHONE/WORK_PHONE/OTHER), `value`, `normalized_value`, `source`, `is_primary`, `active`.
- `customer_addresses` — 3 lignes d'adresse, CP, ville, pays, `type`, `source`, `active`.
- `customer_consents` — indicateurs email/SMS/tel/courrier/marketing conservés tels quels.
- `ref_vehicles` — référentiel véhicule complet : identification (n° Winmotor, immat display + normalisée, ancienne immat, VIN + VIN normalisé), marque/gamme/modèle/version/variante/finition/carrosserie/couleur, caractéristiques (énergie, puissance, cylindrée, boîte, portes, places, type mine/CNIT/D2/TVV), dates (MEC, achat, vente, livraison, CT précédent/prochain), entretien (dernier km, date km, dernière visite).
- `customer_vehicle_relations` — `relationship_type` (OWNER/USER/COMPANY), `start_date`, `end_date`, `active`, `source`.
- `vehicle_mileage_history` — `mileage`, `measured_at`, `source` (WINMOTOR_IMPORT / TOUR_VEHICULE_OCR / EXPERTISE_OCR / MANUAL), `import_id`, `inspection_id`, `photo_id`.
- `field_provenance` — pour les champs clés (email, téléphone, immat, km…) : entité, champ, valeur, source, date source, date import. Permet de ne pas écraser une correction DDA Connect par un ancien export.
- `imports` — fichier, site, utilisateur, statut, compteurs (lignes, créations, MAJ, doublons évités, anomalies), horodatage.
- `import_rows` — `import_id`, `row_number`, `source_vehicle_id`, `source_customer_id`, `raw_data JSONB` (les 236 colonnes intégrales), `processing_status`, `processing_errors`.
- Extension de `sites` : `legal_name`, `address`, `phone`, `email`, `logo_url`, `active`.

Index : immat normalisée, VIN normalisé, `source_vehicle_id`, `source_customer_id`, nom/prénom normalisés, téléphone normalisé, email normalisé, `site_id`, plus index trigram pour la recherche partielle.

Sécurité : lecture du référentiel pour tout utilisateur actif authentifié ; `import_rows.raw_data`, `imports` et les données sensibles réservés aux Managers (RLS `has_role(auth.uid(),'manager')`). Aucun accès anon.

Les tables existantes `clients` / `vehicles` restent en place et intactes ; le nouveau référentiel est la source d'appoint utilisée par la recherche, avec rattachement progressif.

## 2. Import

- Parsing côté client : détection CP1252 (décodage `windows-1252`), séparateur `;`, XLSX via `xlsx`.
- Étape 1 : choix du site + fichier.
- Étape 2 : **analyse** — lignes, colonnes, clients/véhicules détectés, VIN/emails/téléphones disponibles, doublons potentiels, anomalies. Aucune écriture.
- Étape 3 : **import** par lots (~500 lignes) via une server function Manager : insertion des lignes brutes puis résolution/upsert clients, contacts, adresses, véhicules, relations, kilométrage.
- Déduplication véhicule : n° Winmotor (site+source) → VIN valide → immat normalisée. Client : n° client Winmotor → email → téléphone → (nom+prénom+adresse = doublon signalé, jamais fusionné automatiquement).
- Kilométrage : ajout à l'historique, jamais de régression du km opérationnel.
- Champs corrigés dans DDA Connect : conservés, la valeur Winmotor divergente est signalée comme anomalie « donnée Winmotor différente ».
- Étape 4 : **rapport final** avec tous les compteurs + accès aux anomalies.

## 3. Écrans

- `/base` — hub Manager : Import Winmotor, Clients, Véhicules, Historique des imports.
- `/base/import` — assistant 4 étapes ci-dessus.
- `/base/imports` + détail d'un import (compteurs, anomalies).
- `/base/clients` et `/base/vehicules` — listes recherchables paginées.
- `/client/$id` — fiche client : identité, contacts, adresse, véhicules, historique DDA Connect (OR, tours, expertises). Bloc « Informations complètes » (raw) visible Manager uniquement.
- `/vehicule/$id` — fiche véhicule : immat, marque/modèle, VIN, version, MEC, énergie, couleur, dernier km + date, dernier passage, prochain CT, client actuel, historique (OR, tours, expertises, kilométrages, propriétaires) et actions rapides : Créer un OR, Tour Véhicule, Expertise.
- Recherche universelle sur l'accueil et dans le module Tour : une barre unique (immat partielle, nom, prénom, société, n° client, téléphone, mobile, email, VIN, n° véhicule Winmotor, n° OR), insensible à la casse/espaces/tirets, résultats groupés client → véhicules.
- Scan plaque et OCR OR : recherche préalable dans le référentiel, affichage « Véhicule trouvé » avec comparaison OCR, pas de doublon créé.
- Création d'OR préremplie depuis n'importe quel résultat.

L'interface opérateur reste volontairement minimale (immat, marque/modèle, client, demande, OR, kilométrage) ; le détail technique est réservé au Manager.

## Notes techniques

- Recherche via une server function authentifiée avec requêtes indexées (pas de scan client) ; `unaccent` + `pg_trgm` activés.
- Import exécuté par server functions Manager avec vérification du rôle côté serveur.
- Ajout des dépendances `xlsx` (lecture XLSX) et parsing CSV maison compatible CP1252.
