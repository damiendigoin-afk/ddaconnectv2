# Suivi d'activité mensuel (01/09)

## Ergonomie contrôle technique — 29/10
- [x] Un seul parcours photo CT dans le point, lecture et confirmation de l’échéance, saisie manuelle indépendante
- [x] Tests CT photo → OCR → sauvegarde → écran PDF et échecs avec mocks, 1 162 tests réussis, types/compilation automatiques OK, aucune mutation réelle ni publication
- Limite : pas de prise de photo ni de lecture OCR réelle sur Android ; parcours testé avec photo et réponse OCR fictives.

- [x] Migration `activity_imports` / `activity_months` / `activity_values`
- [x] Import Excel déterministe (société, mois, libellés normalisés, anomalies)
- [x] Tableau de bord site / Groupe, comparatifs N-1/N-2, courbes
- [x] Jours ouvrés France et statut mensuel corrigeable
- [x] Tests ciblés, typecheck, build

Phase 2 (non développée) : planning de présence / congés, neutralisation des cessions internes en vue Groupe.

# Correctifs 03/09 soir

- [x] Statistiques équipe : colonnes H achetées / H passées, ligne TOTAL, sélecteur DDA / CASTI / Groupe
- [x] Import CSV : détection du séparateur sur plusieurs lignes (point-virgule Winmotor)
- [x] Statistiques clientèle & véhicules (parc, marques, visites < 24 mois, contacts)
- [x] Module Communication : bibliothèque de supports publicitaires + rotation linéaire
- [x] Paramétrage > API : services, clés masquées, test de connexion (`/api/public/api-check`)
- [x] Référentiel des codes journaux Winmotor + modèle de lettre de relance (inactif)
- [x] PDF tour : uniquement les contrôles réellement effectués

Reste à faire :
- [ ] BL / factures fournisseur : capture photo/PDF, OCR tolérant, écran de validation, états et liaison OR
- [ ] Pneus : seuils de profondeur paramétrables
- [ ] Amortisseurs : un seul contrôle global au lieu de quatre
- [ ] Écran carte clientèle (données déjà préparées)

- [x] 03/09 : module BL / Factures fournisseur (dépôt photo/PDF, OCR tolérant, validation manuelle, états, rattachement OR) — écran /factures-fournisseur, table inbox_documents réutilisée.

# Lot 04/09

- [x] Accueil : arborescence par familles (Atelier, Magasin & achats, Clients & commercial, Communication, Équipe & RH, Statistiques & pilotage, Paramétrage)
- [x] Pneus : chiffrage par essieu (1 roue HS => 2 pneus, 2 essieux => 4, jamais 1 ni 3)
- [x] Nettoyage : forfaits 39 / 79 / 199 € TTC avec pré-estimation modifiable
- [x] Carrosserie : niveaux mineur / réparation MO à déterminer / redressage / remplacement, temps jamais figé
- [x] Import forfaits : non modifié dans ce lot (sujet repris séparément)

## Lot 05/09
- [x] Import forfaits : mémento complet sans découpage, lecture + enregistrement par lots de 20 pages, progression pages/% + estimation, reprise idempotente, contexte famille/opération conservé entre pages, champs séparés (modèle, génération, motorisation, code, prix, page), versions antérieures archivées, recherche par code/opération/famille/modèle/moteur, liste brute supprimée sous le bloc d'import.
- [x] Équivalences véhicules : référentiel générique consultable (/parametrage/equivalences), lien depuis Chiffrage & pneumatiques.
- [x] Paramètres API : IXELLIO déplacé depuis Paramétrage global (mêmes identifiants chiffrés, aucun doublon), cartes Meta et Google Business avec statuts Non configuré / Configuré / Testé / Actif / Erreur.
- [x] Communication par site : contexte site unique, rotation 7 jours glissants sans forçage, ajout par image seule, activation/désactivation, budget et rayon par site, destination fiche Google Business, statistiques réelles uniquement.
- Limite : Meta et Google Business restent « à connecter » tant que les identifiants d'application ne sont pas enregistrés côté serveur.

# Correctif moteur de sélection pneus (11/09)

- [x] Consultation fournisseur par marque ET saison (été / 4 saisons)
- [x] Conformité indice de charge et de vitesse, tolérance 3PMSF (un cran, 4 saisons)
- [x] Choix du moins cher parmi les produits conformes
- [x] Tests, typecheck, build

## V3
- [x] Phase A : navigation V3, hub Atelier, dossier OR (tableau d'actions), scan OR/plaque, recherche multi-sites avec site, Pièces & achats hub, droits = menu.
- [x] Phase B V3 (commandes, réception, stock, pointage OR, travaux terminés, à régulariser)
- [x] Phase C1 : import WinMotor réel (entêtes+détail), historique fiches, recherche facture, contrôle WinMotor, sortie finale stock ; diagnostic du vrai fichier Détail et nettoyage traçable des caractères incompatibles.
- [x] C1 continuation : expédition retour fournisseur = sortie physique (idempotente, À régulariser si référence inconnue). Reste : coût réel depuis facture fournisseur contrôlée (lien ligne facture ↔ réception), test avec vrais CSV.

# UX Pièces & achats — lignes visibles
- [x] Commande OCR : lignes éditables immédiatement visibles
- [x] Commandes en attente : toutes les lignes et reliquats visibles
- [x] Réception depuis commande : lignes restantes directement préremplies
- [x] Tests ciblés, suite complète, typecheck, build
- [x] Publication

# Chiffrage pneus Tour véhicule — essieux et 7 offres
- [x] Regrouper les constats en PNEUS AV / PNEUS AR / 4 PNEUS, toujours par 2 ou 4
- [x] Conserver exactement les 7 offres standard du moteur pneus existant
- [x] Afficher et sélectionner une seule offre comptée dans l'atelier et le devis client
- [x] Couvrir le cas CW-862-AY et les dimensions incomplètes
- [x] Tests ciblés, suite complète, typecheck et build
- [ ] Publication

## Tour pneus — consolidation essieu, fallback gammes, rapport court
- [x] Consolidation dimension/indices par roue puis essieu (toutes photos, conflits, preuves)
- [x] buildSevenOffers : fallback marques de la gamme (sort_order), prix réels pour 4
- [x] Affichage Équivalence + matrice 3x2 (atelier + client)
- [x] Rapport : Synthèse par défaut, Détail en accordéons, pas d'unité seule
- [x] Tests, typecheck, build, publication

## Pneus sans IA — OCR local photo 2 + photo 3
- [x] Désactiver tire_wheel automatique ; OCR local (photos 2 et 3), parser métier, consolidation roue
- [x] Synthèse discrète + correction manuelle ; tests parsing/consolidation ; publication

- [x] Autoriser le dépôt de BL fournisseur (stockage fournisseurs/) aux non-managers du site (erreur RLS Adrien)

## Correctif générique Commander des pièces — PDF achats (29/09)
- [x] Tracer et corriger la chaîne PDF texte → règles → normalisation → formulaire
- [x] Parser les blocs articles OSKARBI 2887082 et Renault Parts 45965672 sans règle fournisseur spécifique
- [x] Ajouter la fixture Renault exacte et un test d’intégration jusqu’aux lignes du formulaire
- [x] Publier directement après typecheck et suite complète verts
- [x] Renforcer fournisseur, date commande, multi-OR, frais et validation métier/score qualité
- [x] Vérifier les deux fixtures exactes, AUTODOC, RETRO, typecheck et suite complète
- [x] Vérifier le formulaire réel avant publication

## Contrat lignes Commander des pièces — PAD 2887178
- [x] Tracer le contrat extraction → normalisation → mapping → état React → champs
- [x] Rendre la normalisation idempotente pour les lignes déjà au format formulaire
- [x] Initialiser en un seul passage lignes, commande, date, OR et immatriculation
- [x] Ajouter un diagnostic structurel sans contenu personnel et les tests des trois fixtures
- [x] Suite complète, typecheck et contrôle navigateur
- [x] Publication

## Vérification production PAD 2887178 — contrat DOM
- [x] Auditer le diff publié, les bundles servis et l'unique route Commander des pièces
- [x] Corriger la priorité des valeurs non vides et accepter lines/items/documentLines
- [x] Monter le composant réel et contrôler les valeurs DOM
- [x] Reproduire avec le PDF utilisateur exact et corriger la première pièce extraite sur deux lignes
- [ ] Suite complète, typecheck, publication et contrôle visuel du PDF exact

## Recette IA documentaire (banc A/B)
- [ ] Migration tables ai_bench_* (RLS gérant) + budget benchmark séparé
- [ ] Service IA : bypass cache, métriques, exclusion benchmark du budget prod
- [ ] Schéma/scores/classification/export (purs) + tests
- [ ] Fonctions serveur (préparation média, classification, A/B, pipeline réel sans écriture métier)
- [ ] Page /parametrage/recette-ia mobile-first + campagnes + exports
- [ ] Tests, typecheck, build (pas de publication)

## Lot 03/10 — État pneus / tour rapide / scan OR
- [x] État pneus : masques U (bande) et cercle (flanc) en caméra, enchaînement auto Bande > Flanc > Complément
- [x] État pneus : photos conservées dans l'historique véhicule ; photo annotée dans le devis pneu PDF
- [x] Tour du véhicule : bouton caméra (immat ou OR), tour sans OR
- [x] Scan OR : contrôle strict immat (EMA426NG), modèle ≠ compte/OR/tél/CP, tableau Renault, prompt IA
- [x] Tests ciblés + typecheck (pas de publication)

## Lot correctif 03/10 — Tour pneus global / OR / référentiel
- [ ] Ajuster les masques caméra bande, flanc et conserver dimension
- [ ] Ajouter le démarrage rapide Tour plaque/OR sans dossier OR obligatoire
- [ ] Renforcer plaque, marque, modèle et remarques OR 50985
- [ ] Donner priorité à ref_vehicles sans nettoyage global
- [ ] Capturer 12 photos pneus et analyser globalement à Terminer
- [ ] Ajouter progression, reprise, validation tactile des 4 roues et persistance
- [ ] Appliquer les règles essieu/4 pneus et réutiliser le devis/PDF existant
- [ ] Tests ciblés, suite complète et typecheck ; ne pas publier

# Liste d approvisionnement multi-fournisseurs (04/10)
- [x] Tables + RPC generate_procurement_orders (0048/0049)
- [x] Lecture déterministe + IA de secours, écran dans Commander des pièces
- [x] Tests parsing (ROADIA 9, Ixellio 5, Audi 12) + règles de génération
- [x] Rollback vite-tanstack-config 2.23.1 (502 prod 08/10)

# Incident 08/10

- [x] Production 502 au démarrage : modules OCR/QR (tesseract.js, qrcode/pngjs) retirés du serveur construit
- [x] Retry stockage transitoire (429/503) sur uploads documents fournisseur

- [x] Commander chez DC : commande interne à transmettre + validation manuelle portail

- [x] Commander chez DC : aide panier Districash (réf. commande OR>immat, copie, ouverture fiche), sans achat

# BL fournisseurs — vision d'abord (19/10)

- [x] Photos / scans image : vision IA en premier, règles OCR en complément des seuls champs absents
- [x] Contrôles chiffrés (somme lignes, HT+TVA=TTC, tarif×remise, TVA≠qté, prix aberrants) + alerte « Lecture à vérifier »
- [x] N° BL principal (duplicata) vs réf. BL source ; colonnes remise/TVA ; référence collée à la désignation
- [x] Fournisseur par TVA / SIRET / site web ; avertissement si deux lectures divergent
- [x] Rapprochement : réf. exactes prioritaires, autres commandes repliées
- [ ] Renseigner TVA / site dans la fiche FAURIE AUTO SARLAT (donnée utilisateur)
- [ ] Essai réel avec photos des BL 916076 / 916084 après publication

# BL / factures photo — fail-closed (19/10)
- [x] Vision en échec / contrôles en échec après relecture => « Lecture à vérifier », sans rattachement ni suggestion auto
- [x] N° / date facture liés au libellé, dates de paiement/échéance/LCR exclues, n° en forme de date rejeté
- [x] Fournisseur : SIRET/TVA d'abord, établissements d'un groupe distincts, nom de groupe seul insuffisant
- [x] Lignes part/fee + code variante ; frais exclus du rapprochement ; filtre fournisseur sur recherche manuelle
- [ ] Rescanner la facture Faurie Brive 02-5018641 après publication
- [x] Perf lecture BL photo : vision directe, Tesseract en secours, upload parallèle, étapes UI, timings
- [x] Diagnostic catalogue IXELLIO par référence (managers, lecture seule)
- [ ] Relever une fixture réelle PieceRecherche (premier essai manager)

## Correction / annulation notes de frais
- [x] Versions immuables, motifs, droits et verrou de concurrence
- [x] Modification / annulation explicites, revalidation et historique consultable
- [x] PDF versionnés, corrections comptables par destinataire, idempotence et prise en compte distincte
- [x] Tests sans mail réel, compilation automatique et ouverture connectée de l'éditeur / historique
- [ ] Recette complète correction puis validation comptable : nécessite une note de test autorisée et un destinataire de test (aucun mail réel permis)

## Devis pneus Top prix
- [x] Icône « Autre marque, même gamme » par case (écran interne), cycle par marque sur offres consultées
- [x] Nankang classée entrée (correction DDA, paramétrage prioritaire)
- [ ] Référentiel mondial des gammes de marques (sources, alias, à vérifier), appliqué classique + Top prix + web
