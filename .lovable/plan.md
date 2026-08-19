# DDA Connect V3 — feuille de route

Périmètre énorme : je le découpe en 8 lots livrables l'un après l'autre. Rien de la V2.6/V2.7 n'est supprimé — tout est additif ou correctif.

Chaque lot = une migration base + les écrans, testé avant de passer au suivant.

---

## Lot 1 — Socle multi-sites + utilisateurs (base de tout le reste)
- Table `sites` enrichie : Castillon (Garage Castillon Veyssière) et DDA / Lalinde (Damien Digoin Automobile) — logo, coordonnées, entêtes, mentions PDF.
- Fiche utilisateur : champ **Site par défaut** (Castillon / DDA-Lalinde / Groupe), prérempli d'après le domaine de l'email, toujours modifiable, jamais bloquant.
- Sélecteur de site dans l'entête de l'app : changement ponctuel sans modifier le site par défaut.
- Le site actif pilote : logo, entêtes, coordonnées, filtres par défaut, contexte des modules, PDF.
- Mode Groupe : données consolidées Castillon + Lalinde, logo commun « St Cyprien & Lalinde ».
- Gestion utilisateurs : droits par module (existants, conservés) + bloc Gmail (autorisation, état de sync, dernier passage, boutons connecter / reconnecter / déconnecter).

## Lot 2 — Tour véhicule : corrections UX + PDF
- Suppression de l'écran « Démarrer le tour » : le chrono démarre en arrière-plan à l'ouverture, l'opérateur arrive sur la première étape.
- Bouton **Exporter PDF** sur un tour clôturé (à côté d'Aperçu client / Copier le lien) : A4 imprimable avec logo du site, coordonnées, client, véhicule, immat, km, date/heure, opérateur, résumé des contrôles, observations, photos des anomalies.
- Le PDF est affichable, imprimable, archivé dans les documents du dossier et joignable à un email.

## Lot 3 — Documents / OCR commun + qualité des données
- Couche unique de reconnaissance documentaire utilisable partout : OR, carte grise, avis de sinistre, mémo assurance, facture d'entretien, rapport d'expertise, BL, facture fournisseur, photo, PDF.
- Chaîne : reconnaître le type → extraire → chercher le dossier → rattacher si confiance suffisante → sinon file **« À classer »**. Aucun document n'est jamais perdu.
- Chaque donnée extraite garde source / date / niveau de confiance.
- Moteur de fusion clients & véhicules : pas de doublon si une fiche existe, jamais d'écrasement d'une donnée plus récente ou plus fiable par une plus ancienne (ex. km relevé aujourd'hui vs import Winmotor ancien).
- Historique des modifications et fusions + **score de complétude** de la fiche véhicule (« complète à 90 % – code moteur manquant »).

## Lot 4 — Flux emails Gmail + déduplication
- Connexion de plusieurs boîtes Gmail / Workspace via API Gmail (OAuth par utilisateur), synchronisation en arrière-plan planifiée.
- Stockage par email : date, heure, expéditeur, destinataires, CC, boîte d'origine, objet, contenu, ID Gmail, fil, pièces jointes, catégorie, score de confiance.
- Catégorisation automatique (atelier, carrosserie, VN/VO, devis, RDV, client, assurance, expert, fournisseur, BL, compta, RH, administratif, Renault, autre).
- Liste avec filtres et recherche + tableau de bord (volumes jour / semaine / boîte / catégorie, taux de classement auto).
- Anti-doublons : comparaison Message-ID, expéditeur, objet, date, contenu, fil → une seule entrée métier, avec « Reçu par : Damien, Anaïs, Frédéric ». Transfert, réponse et nouveau message du fil ne sont pas des doublons.
- V3.0 = collecte / affichage / consolidation / qualification uniquement, pas de réponse automatique.

## Lot 5 — Carrosserie V3 : workflow, DARVA, expert
- Workflow explicite : entrée dossier/sinistre → expertise → accord → planification → commande pièces → réparation → contrôles → facturation/restitution → archivage. Séparation stricte **type de réparation** (ex. Grêle) / **statut** (ex. VGE) / **étape**.
- Base assureurs structurée : réseau / agrément / garage concerné / validité / conditions / workflow / tarifs / documents obligatoires / règles de facturation. Les agréments expirés restent consultables.
- DARVA comme canal distinct : réception mission, consultation, ouverture OR, envoi expertise, facturation séparés. Alerte claire si une mission DARVA est traitée comme un OR classique. Statut « EAD réalisée – en attente mission DARVA » + alerte si la mission tarde.
- Bouton unique **« Communiquer avec l'expert »** : caméra → scan de l'OR → dossier et expert retrouvés → motif (passage terrain, travaux complémentaires, autre) → commentaire prérempli modifiable → photos en rafale → Terminé → email généré et envoyé à l'expert du dossier. Module d'émission seul ; historisation complète dans le dossier ; modèles de messages éditables par l'admin.

## Lot 6 — CRM + recherche universelle
- Demandes CRM : client, véhicule, source, motif, responsable, création, échéance, urgence, statut, historique, prochaine action. Statuts : reçue, affectée, en cours, en attente client, en attente interne, terminée, sans suite avec motif. Aucune demande sans issue enregistrée.
- Escalade automatique responsable → relance → collègues du périmètre → manager, délais configurables par type, urgence visuelle vert → orange → rouge.
- Recherche universelle partout : nom, prénom, téléphone, email, immat, VIN, n° OR, n° sinistre, suggestions pendant la frappe avec fiche express (client, véhicule, dernière visite, dernière intervention, dernière interaction CRM, action en cours). Point d'entrée technique prévu pour une future téléphonie, sans dépendance.

## Lot 7 — Entretien prédictif + base de connaissances
- Scan en rafale (OR, carte grise, anciennes factures, programme d'entretien, autres) → extraction véhicule, mise en circulation, km, énergie, motorisation, code moteur, interventions passées.
- Comparaison au programme officiel / forfaits Renault / temps barémés / règles internes → liste : à proposer, à contrôler, déjà réalisé, non applicable, information manquante, chacune avec justification et source.
- Chiffrage : forfait Renault en priorité, sinon temps barémé + tarifs internes. Validation humaine obligatoire.
- Base de connaissances versionnée (forfaits, programmes, barèmes, procédures, conventions, agréments, garanties, formations) avec titre, type, source, dates de validité, version, statut. Trois niveaux : officiel / règle interne validée / observation terrain. File « Connaissances à valider », validation admin obligatoire.

## Lot 8 — Pilotage, recouvrement, VN/VO, notes de frais, RPA, santé plateforme
- Pilotage : vues Groupe / Site / Activité, comparaisons N, N-1, N-2, YTD, année, objectifs/réalisé, tendances, alertes, anomalies. Historiques CASTI et DDA conservés.
- Recouvrement : import balance âgée Winmotor, client/facture/montant/ancienneté/priorité/statut, historique de relances, relances email (SMS plus tard), indicateurs encours et retards >30 j.
- VN/VO : leads, source, actions commerciales, véhicules, opportunités, historique.
- Notes de frais : 1 note = 1 justificatif (société, date, catégorie, montant, photo/PDF, commentaire). Pas de champ fournisseur, pas de module carburant séparé.
- Centre d'automatisation : DDA Connect orchestre, un agent RPA Windows exécute via une connexion sortante sécurisée (aucun port entrant). Planification, lancer maintenant, statut, dernière/prochaine exécution, succès/échec, capture d'écran en cas d'erreur, reprise, file locale hors ligne.
- Santé plateforme : stockage base/photos/PDF/pièces jointes, volumes emails, consommation IA et Gmail, erreurs de sync, quota Resend et emails envoyés, état OK/attention/critique, estimation fin de mois, seuils d'alerte.

---

## Points techniques
- Chaque lot ajoute ses tables avec droits d'accès stricts par rôle et par site, et respecte la gestion des droits par module existante.
- Les traitements lourds (sync Gmail, dédoublonnage, RPA, imports) tournent en tâches planifiées côté serveur, avec verrou anti-concurrence et reprise, jamais depuis l'écran.
- Gmail nécessite des identifiants OAuth Google (client ID / secret) que tu devras fournir au moment du lot 4.
- Le RPA (lot 8) fournit côté DDA Connect la file de tâches et le suivi ; l'agent Windows lui-même est un programme à installer sur ton serveur, hors périmètre de cette application web.

## Ordre proposé
Lot 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Dis-moi si tu veux changer l'ordre (par exemple faire la carrosserie/DARVA avant les emails).
