# Suivi d'activité mensuel (01/09)

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
- [ ] Tracer et corriger la chaîne PDF texte → règles → normalisation → formulaire
- [ ] Parser les blocs articles OSKARBI 2887082 et Renault Parts 45965672 sans règle fournisseur spécifique
- [ ] Renforcer fournisseur, date commande, multi-OR, frais et validation métier/score qualité
- [ ] Vérifier les deux fixtures exactes, AUTODOC, RETRO, typecheck et suite complète
- [ ] Vérifier le formulaire réel sans publier
