# Audit et estimation — Paramètres > Établissements et Salariés

Analyse en lecture seule. Aucun fichier, migration, donnée ou paramètre modifié ; rien ne sera fait avant votre autorisation explicite. (Le plan DDA Assistant précédent reste archivable séparément et n'est pas concerné.)

## (a) Existant constaté

Tables (vérifiées en base) :
- `sites` : id, code, name, legal_name, address, postal_code, city, phone, logo_url, email_from_name/address, active, is_default. Aucun champ horaires, SIRET, e-mail de contact, calendrier. Remplissage : Castillon a une raison sociale, pas d'adresse ni de téléphone ; Damien Digoin Automobile (code `dda`) n'a ni raison sociale, ni adresse, ni téléphone. RLS : lecture par utilisateurs actifs, écriture managers.
- `profiles` : identité, e-mail, statut, site par défaut, site_scope, username, gmail_allowed. 16 profils rattachés à Castillon, 9 à Lalinde. Un profil « Adrien Benoist » unique trouvé (correspondance fiable). RLS : lecture soi-même ou manager.
- `user_sites`, `user_functions` (clés libres : comptabilite, atelier, magasin_achats, vente…), `user_roles`, `user_module_access` : déjà gérés dans l'écran Utilisateurs.
- `winmotor_operators` (alias WinMotor ↔ user_id par site) et `productivity_entries` (heures WinMotor importées) : utiles plus tard pour la capacité réelle, non touchés ici.

Écrans :
- `/utilisateurs` (src/routes/utilisateurs.tsx, src/lib/users.ts, src/lib/user-functions.ts) : validation, rôle, droits par module, fonctions, site par défaut, sites supplémentaires, alias WinMotor.
- `/parametrage` (src/routes/parametrage.index.tsx) : liste d'entrées réservée aux managers. **Aucun écran d'édition des établissements** : `sites` n'est lu qu'en liste (src/lib/sites.ts, src/lib/referentials.ts).
- Logique : src/lib/activity/workdays.ts contient déjà le calcul des jours fériés français (Pâques et fêtes mobiles) et des jours ouvrés — réutilisable tel quel.

Absent : horaires, exceptions de calendrier, fiche salarié distincte du compte, annuaire sans compte, planning individuel, coefficient de capacité.

## (b) Solution minimale

### Établissements
Base :
- `sites` : ajout de colonnes facultatives (siret, contact_email, website, timezone défaut Europe/Paris). Rien de renommé.
- `site_opening_hours` (site_id, jour 1-7, heure début, heure fin, ordre) — plusieurs plages par jour ; jour sans ligne = fermé.
- `site_calendar_exceptions` (site_id, date, type fermeture | ouverture | horaires spéciaux, plages facultatives, libellé, created_by). Les fériés ne sont pas stockés : calculés par workdays.ts, fermés par défaut ; une exception « ouverture » sur un férié l'emporte.
- Données initiales pour les deux sites, par migration : lun-jeu 08:00-12:00 / 14:00-18:00, ven 08:00-12:00 / 14:00-17:00, sam-dim fermés.
- RLS : lecture utilisateurs actifs, écriture managers (même modèle que `sites`). GRANT explicites.

Code :
- src/lib/site-calendar.ts (pur, testé) : `isOpenAt(site, date)`, `openingSlots(site, date)`, `openHoursBetween(...)` fusionnant horaires + fériés + exceptions. Point d'entrée unique pour KITT, RDV, charge atelier plus tard.
- src/routes/parametrage.etablissements.tsx (+ entrée dans parametrage.index.tsx) : fiche par garage (identité, adresse, téléphone), grille horaires multi-plages, calendrier annuel (fériés affichés, exceptions ajoutables/supprimables).

### Salariés
Base :
- `employees` (id, user_id unique facultatif → profiles, first_name, last_name, function_label, service, specialty mécanique | carrosserie | peinture | magasin | accueil | autre, active, payroll_ref facultatif, phone_extension, direct_line, transfer_number, capacity_coefficient 0-100 défaut 100, notes). Personne sans compte = `user_id` vide. Aucune donnée de salaire ou de santé.
- `employee_sites` (employee_id, site_id) — plusieurs garages possibles.
- `employee_schedule` (employee_id, semaine A | B | toutes, jour, début, fin, ordre).
- `employee_schedule_exceptions` (employee_id, date, absent | horaires spéciaux, plages, libellé). Pas de gestion de congés.
- RLS : lecture par managers et par l'intéressé (sa propre fiche via user_id) ; écriture managers. Pas de lecture générale par tous les salariés (numéros, matricule).
- Coefficient initial : Adrien Benoist 50 % seulement s'il est créé par rattachement à son compte (correspondance unique vérifiée) ; tous les autres 100 % par défaut, sans inférence.

Code :
- src/lib/employees.ts (lecture/écriture) et src/lib/employee-capacity.ts (pur, testé) : heures planifiées sur une période (planning A/B + exceptions + fériés/fermetures du site) × coefficient = capacité théorique, libellée « théorique ».
- src/routes/parametrage.salaries.tsx : liste filtrable par garage, fiche (identité, garages, fonction, spécialité, actif, matricule, poste/SDA/transfert, planning hebdo A/B, exceptions, coefficient, capacité théorique de la semaine).
- Bouton « Créer depuis un compte » : propose les profils sans fiche ; « Lier un compte » : liste des profils, choix manuel uniquement. Aucune création automatique pour les 26 comptes.
- Écran Utilisateurs : simple lien vers la fiche salarié si elle existe. Droits, fonctions et sites restent gérés là (pas de duplication).

### Effectifs (préparation seulement)
Rien d'importé. Prévu pour plus tard : écran de réconciliation qui compare une liste nominative fournie aux fiches/comptes, propose les correspondances exactes, signale homonymes et inconnus, et n'applique qu'après confirmation ligne par ligne. Aucun champ salaire.

## (c) Risques

- **Doublon de personnes** : `employees.user_id` unique ; une fiche ne recopie pas l'e-mail ni le rôle du compte (lus depuis profiles) ; nom affiché depuis la fiche, compte resté maître des droits.
- **RLS** : `profiles` n'est lisible que par soi ou manager — la page Salariés reste manager. Les numéros et matricules ne doivent pas fuiter aux salariés ; pas de policy « tous actifs » sur `employees`.
- **Compatibilité** : colonnes ajoutées en facultatif, aucune colonne renommée ; tous les écrans qui lisent `sites` continuent de fonctionner. Types générés à régénérer.
- **Fuseau / heures** : plages stockées en heure locale, calculs en Europe/Paris ; attention au changement d'heure dans les calculs d'heures.
- **Fériés** : Alsace-Moselle non concerné ; ponts non fermés par défaut (exceptions manuelles).
- **RGPD** : matricule et numéros = données personnelles ; minimiser, accès manager.
- **Adrien Benoist** : un seul profil trouvé ; confirmation visuelle avant application du 50 %.

## (d) Étapes et tests

1. Migration établissements (colonnes, deux tables, horaires initiaux, RLS, GRANT) + types.
2. site-calendar.ts + tests : vendredi 16:30 ouvert, 17:30 fermé ; lundi 12:30 fermé ; 11/11 et lundi de Pâques fermés ; exception « ouverture » sur férié ouverte ; fermeture exceptionnelle un mardi fermée.
3. Écran Établissements + entrée Paramétrage ; test manager édite, salarié ne peut pas.
4. Migration salariés (quatre tables, RLS, GRANT) + types.
5. employee-capacity.ts + tests : 39 h planifiées × 50 % = 19,5 h ; semaine A/B alternée ; jour férié retiré ; exception absente retirée ; coefficient borné 0-100.
6. Écran Salariés : créer depuis un compte, créer sans compte, lier manuellement, refus de lier un compte déjà lié.
7. Fiche Adrien Benoist à 50 % après confirmation.
8. Vérification connectée : manager et salarié, chaque site.

## (e) Estimation

| Bloc | Crédits Lovable | Durée indicative |
|---|---|---|
| Établissements : base + calendrier + tests | 5 – 9 | |
| Établissements : écran fiche + horaires + calendrier annuel | 6 – 12 | |
| **Sous-total Établissements** | **11 – 21** | ~½ à 1 journée de sessions |
| Salariés : base + RLS + tests capacité | 6 – 11 | |
| Salariés : écran liste/fiche, planning A/B, exceptions, liaison compte | 10 – 18 | |
| Vérification connectée et corrections | 3 – 8 | |
| **Sous-total Salariés** | **19 – 37** | ~1 à 2 journées |
| **Total** | **≈ 30 – 58** | |
| Plus tard : réconciliation effectifs | 6 – 12 | |

Facteurs de variation : niveau de finition du calendrier annuel (vue 12 mois vs liste) ; nombre d'allers-retours sur l'ergonomie mobile ; besoin d'afficher la capacité par garage/semaine ; corrections de droits découvertes au test connecté. Estimation indicative, le coût réel dépend des échanges.

## À confirmer
1. Raison sociale, adresse, téléphone des deux garages (à saisir par vous dans l'écran, ou à me transmettre).
2. Liste des spécialités souhaitées.
3. Un salarié doit-il voir sa propre fiche et son planning, ou réservé aux managers ?
4. Matricule paie utile ou non.
5. Semaine A/B : date de référence de la semaine A.

Attente de validation, aucune modification.
