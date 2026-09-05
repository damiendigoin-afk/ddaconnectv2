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
