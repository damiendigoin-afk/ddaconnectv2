# Étude globale KITT — assistant vocal, téléphonie, demandes, paramètres (V1 Castillon)

Ce document sert uniquement d'étude. Je n'ai rien développé, migré, écrit en base, connecté ni publié. Aucun lot ne démarrera sans votre autorisation explicite.

## 1. Audit de l'application actuelle

### Données WinMotor déjà importées (lues en base le 10/10/2026)
| Élément | Volume | Remarque |
|---|---|---|
| `customers` (source winmotor, 2 sites) | 12 026 | une fiche par site, aucune fusion entre sites |
| `customer_contacts` (EMAIL, MOBILE, PHONE, OTHER, `normalized_value` indexé) | 16 322 | 12 659 ressemblent à des numéros ; 9 182 clients ont au moins un téléphone |
| Valeurs de contact partagées par plusieurs clients | 1 386 | téléphones de famille ou d'entreprise : risque de mauvaise identification |
| Homonymes nom + prénom présents sur les deux sites | 54 | doublons probables entre sites, à ne pas fusionner automatiquement |
| `ref_vehicles` / `customer_vehicle_relations` | 19 923 / 20 494 | lien client ↔ véhicule disponible |
| `vehicles` (ancien) / `clients` (ancien) | 961 / 144 | anciens modèles, à ne pas utiliser pour KITT |
| `repair_orders` | 1 307 | KITT ne donne pas l'avancement des OR (décision prise) |
| `customer_consents` | 0 | modèle présent, aucun consentement enregistré |
| `crm_requests` + `crm_request_events` | 0 ligne | table + écran /crm existants, jamais utilisés |

### Socle réutilisable (vérifié dans le code)
- Sites et droits : `sites`, `profiles`, `user_sites`, `user_functions`, `user_roles`, `user_module_access`, registre des modules (src/lib/access.ts), `ModuleGate`, écran /utilisateurs, site actif (src/lib/site-context.tsx).
- Jours ouvrés et fériés français : src/lib/activity/workdays.ts (Pâques et fêtes mobiles déjà calculées).
- E-mail transactionnel et gabarit : src/lib/email.server.ts, module-email.server.ts. Destinataires par site et journal : `tour_notification_recipients` / `tour_notifications` (modèle à reproduire).
- Clés chiffrées et page Paramètres API : `integration_credentials`, src/lib/crypto.server.ts, /parametrage/api ; budget et journal IA : `ai_budget_settings`, `ai_usage_log`, src/lib/ai-usage.server.ts.
- Stockage privé `dda-media` avec liens signés valables 5 min, réutilisable pour les enregistrements.
- Adresses web publiques `/api/public/*` avec vérification de signature (modèle Gmail).
- Liens WinMotor ↔ utilisateur : `winmotor_operators` ; heures productives : `productivity_entries`.
- Agent WinMotor (`winmotor_agent_jobs`) : présent, mais la nouvelle synchro est reportée, donc non utilisé.

### Ce qui manque
Écran d'édition des établissements, horaires et exceptions ; fiches salariés (avec ou sans compte), poste/SDA, planning, ratio de capacité ; téléphonie et IA vocale ; journal d'appels, transcriptions, enregistrements ; demandes avec attribution, relances, escalade et clôture ; budget voix ; tableau de bord ; bilan hebdomadaire ; tâches planifiées (relances et rapport). Aucune intégration Twilio, OpenAI Realtime ou 2L dans le code.

## 2. Architecture

```text
Appelant ─► Standard 2L ─(renvoi : débordement / hors ouverture)─► Twilio +33973921023
                                                         │ webhook d'appel signé (/api/public/voice/*)
                                                         ▼
                                  Relais voix (serveur) ◄──► IA vocale temps réel (voix KITT unique)
                                         │ outils métier (fonctions serveur, jamais d'accès direct à la base)
              ┌──────────────────────────┼───────────────────────────────┐
     identifier_appelant()     créer/compléter_demande()        transférer(SDA) / rappel()
     (index téléphone, sans    (résumé, priorité, attribution)   (Twilio Dial 20 s, 2e collaborateur,
      divulgation)                                               sinon demande de rappel)
                                         ▼
               DDA Connect : appels, demandes, notifications, e-mails, tableau de bord, budget
               Tâches planifiées : relance 2 h ouvrées, escalade 1 jour ouvré, rapport lundi 12 h
```

Points clés :
- **Décrochage** : seul le standard 2L décide quand renvoyer. Pendant l'ouverture, ce sont les humains qui répondent en premier et KITT prend le débordement ; hors ouverture, c'est KITT. L'étiquette « débordement » ou « hors ouverture » vient des horaires de l'établissement (pause 12-14 = hors ouverture).
- **Deux appels simultanés** au maximum, contrôlés par un compteur ; un troisième appel reçoit une annonce et une demande de rappel. 2L : 1 renvoi à la fois aujourd'hui, devis demandé pour 2 ou 3.
- **Transfert** vers la SDA d'un salarié présent selon son planning, avec 20 s de sonnerie, puis un second collaborateur, puis une demande de rappel. Un transfert vers l'autre garage n'est possible que si son numéro est paramétré et le test validé. Un client qui refuse l'IA est transféré pendant l'ouverture ; sinon, une demande de rappel est créée.
- **Identité** : numéro de l'appelant au format international (+33…), recherché dans les contacts du site avec un temps de réponse maximal ; accueil par le nom seulement si le numéro correspond à un seul client, sinon accueil neutre (1 386 numéros partagés). Une confirmation est demandée avant toute information sensible. Aucune fusion de fiches.
- **Scénarios** : blocs inspirés des scripts Renault (accueil, objet, immatriculation et kilométrage, coordonnées, disponibilités, reformulation), plus des thèmes : urgence et panne (consignes de sécurité, aucune promesse), réclamation, VN/VO, assurance/expert, fournisseur, banque, administration, recrutement, prospection. Interdits : confirmer un RDV, donner un prix, donner l'avancement d'un OR. Plusieurs sujets dans un appel donnent une seule demande. Un appel interrompu crée une demande, reprise au rappel.
- **Demandes** : nouvelle table dédiée, ou extension de `crm_requests` (inutilisée) — recommandation : étendre `crm_requests` pour éviter un doublon de module. Attribution par règles (thème → fonction/service → salarié présent). E-mail + notification dans DDA uniquement pendant l'ouverture, aucune alerte la nuit. Relance après 2 h ouvrées, escalade après 1 jour ouvré, clôture avec commentaire obligatoire, appels répétés rattachés avec priorité réévaluée, marquage personnel/confidentiel visible seulement par les personnes autorisées.
- **Budget voix** : compteur interne estimé en temps réel (minutes × tarifs paramétrés), plafond mensuel de 100 € HT, alertes à 80 € et 90 €, ajout d'un palier de 50 € par la direction depuis DDA, retour à 100 € chaque mois. Un appel en cours n'est jamais coupé. Plafond atteint : les nouveaux renvois sont refusés et KITT passe en repli (message court + demande de rappel, ou retour vers la messagerie du standard). La facture réelle des fournisseurs arrive en décalé et sert au rapprochement.
- **Qualité** : détection d'appel problématique (refus, colère, échec de transfert, coupure, durée supérieure à 6 min) avec alerte au front office ; les propositions de correction sont stockées et validées par la direction, sans apprentissage automatique. Bilan e-mail le lundi à 12 h.
- **Erreurs et sécurité** : webhooks Twilio signés et idempotents ; si l'IA est indisponible, message de repli et demande de rappel ; outils limités au site appelé ; enregistrements privés, liens courts, purge automatique à 3 mois (sous réserve RGPD) ; transcriptions limitées aux rôles autorisés ; clés conservées côté serveur.

### Fournisseurs (tarifs à vérifier au moment du choix)
| Brique | Option recommandée | Alternatives | Ordre de grandeur |
|---|---|---|---|
| Téléphonie | Twilio Voice (numéro FR déjà sélectionné) | Vonage, Telnyx | entrant ≈ 0,01 €/min ; transfert sortant vers mobile FR ≈ 0,03-0,15 €/min ; numéro ≈ 1-5 €/mois ; enregistrement ≈ 0,0025 $/min + stockage |
| IA vocale temps réel | OpenAI Realtime / modèle live via la passerelle Lovable (voix unique, coupure de parole) | ElevenLabs Conversational, Deepgram + TTS, Gemini Live | ≈ 0,05-0,30 €/min selon modèle et part audio, **à vérifier** |
| Transcription / résumé | Inclus dans le flux temps réel ou transcription après appel + modèle texte | — | ≈ 0,005-0,02 €/min |
| E-mail | Envoi existant de DDA | — | négligeable |
| Stockage | Lovable Cloud (`dda-media`) | — | ≈ 1 Mo/min en MP3 ; 3 mois ≈ quelques Go |

## 3. Lots, dépendances, tests et critères d'acceptation

### MVP Castillon
| Lot | Contenu | Dépend de | Critères d'acceptation |
|---|---|---|---|
| L1 Établissements | Fiches, horaires multi-plages (valeurs validées pré-remplies), fériés FR, exceptions, calcul `isOpenAt` | — | Ven 16:30 ouvert / 17:30 fermé ; lun 12:30 fermé ; 11/11 fermé ; ouverture exceptionnelle prise en compte |
| L2 Salariés | Annuaire lié aux profils ou sans compte, sites, fonction/spécialité, SDA, planning fixe ou A/B, exceptions, ratio 0-100 %, capacité théorique | L1 | Pas de doublon de personne ; liaison manuelle seulement ; Adrien Benoist à 50 % après vérification ; 39 h × 50 % = 19,5 h |
| L3 Demandes | Extension de `crm_requests` : thèmes, priorité, attribution, relance 2 h ouvrées, escalade 1 jour, clôture commentée, confidentialité, rattachement des appels répétés | L1, L2 | Aucune alerte la nuit ; relance au bon moment ouvré ; clôture refusée sans commentaire ; demande confidentielle invisible aux non-autorisés |
| L4 Journal d'appels | Appels, transcriptions, enregistrements, résumé structuré, purge à 3 mois | L3 | Une seule ligne par identifiant d'appel ; enregistrement lisible seulement par les autorisés ; purge testée |
| L5 Identité appelant | Index des numéros depuis les contacts importés, score, règles d'accueil, journal | — | Numéro partagé ou masqué → neutre ; aucun nom faux sur les jeux de test ; temps de réponse dépassé → neutre |
| L6 Moteur KITT | Instructions, blocs de scénarios, outils métier, interdits, urgences, multi-sujets, interruption | L3, L5 | Jeu de 30 appels simulés : aucun prix, RDV ou avancement d'OR donné ; une demande par appel ; urgence sans promesse |
| L7 Relais voix + Twilio | Webhooks, relais temps réel, 2 appels simultanés, transferts 20 s / 2e collaborateur / rappel, repli | L6 ; **numéro approuvé, test 2L** | Appel test complet sous 3 min ; 3e appel → repli ; transfert sans réponse → 2e collaborateur puis rappel |
| L8 Budget voix | Compteur, plafond, alertes 80/90, palier 50 €, remise mensuelle, repli sans coupure | L4, L7 | Simulation 79 → 81 € : alerte ; plafond atteint pendant un appel → appel terminé normalement, suivant en repli |
| L9 Tableau de bord + bilan | Volumes, durées, transferts, causes, traitement, rappels, dépenses, heures ; e-mail lundi 12 h | L3, L4, L8 | Chiffres identiques au journal ; e-mail envoyé une seule fois par semaine |
| L10 Qualité supervisée | Détection d'appels problématiques, alerte, propositions soumises à validation | L4 | Aucune règle modifiée sans validation |
| L11 Recette et mise en service | Tests internes complets, activation Castillon hors ouverture **et** en débordement, retour arrière (désactivation du renvoi 2L et interrupteur KITT) | tout | Check-list signée ; retour arrière testé |

Réalisables dès maintenant, sans Twilio : L1 à L6, L8 (sauf tarifs réels), L9, L10. Bloqué : L7 et la partie téléphonique de L11.

### Phase 2
Lalinde (sites, numéros, destinataires) ; synchro WinMotor nocturne et fusion des fiches client dans DDA (sans fusion comptable) ; charge atelier ; transfert inter-garages si non validé en V1 ; Messenger.

## 4. Estimation en crédits Lovable

Les 30-58 crédits de l'étude précédente correspondent à L1 + L2 et sont inclus ci-dessous, sans double compte.

| Lot | Optimiste | Pessimiste |
|---|---|---|
| L1 Établissements | 11 | 21 |
| L2 Salariés | 19 | 37 |
| L3 Demandes | 18 | 35 |
| L4 Journal d'appels | 10 | 20 |
| L5 Identité appelant | 6 | 12 |
| L6 Moteur KITT | 18 | 35 |
| L7 Relais voix + Twilio | 25 | 55 |
| L8 Budget voix | 8 | 16 |
| L9 Tableau de bord + bilan | 12 | 25 |
| L10 Qualité supervisée | 6 | 14 |
| L11 Recette et mise en service | 12 | 30 |
| **Total MVP Castillon** | **≈ 145** | **≈ 300** |
| Phase 2 (Lalinde + synchro WinMotor + fusion) | 40 | 90 |

Durée indicative : L1-L6 en 1 à 2 semaines de sessions ; L7-L11 en 1 à 2 semaines après le test 2L ; soit environ 3 à 5 semaines au total, selon vos disponibilités pour la recette. Facteurs de variation : qualité de la voix et réglage des interruptions (L7), nombre d'itérations sur les scénarios, comportement réel du renvoi 2L, finition du tableau de bord.

## 5. Coûts mensuels externes (hors crédits Lovable, estimations)

Hypothèse : 3 min par appel, IA à 0,10-0,25 €/min, téléphonie entrante à 0,01 €/min, 20 % des appels transférés pendant 2 min à 0,05 €/min.
| Appels / mois | Minutes | IA | Téléphonie + transferts | Enregistrement + stockage | Total estimé |
|---|---|---|---|---|---|
| 150 | 450 | 45-113 € | ≈ 8 € | ≈ 2 € | ≈ 55-123 € |
| 250 | 750 | 75-188 € | ≈ 13 € | ≈ 3 € | ≈ 91-204 € |
| 400 | 1 200 | 120-300 € | ≈ 20 € | ≈ 5 € | ≈ 145-325 € |

Avec 100 € HT par mois, on peut compter environ **130 à 300 appels de 3 min**, selon le modèle vocal retenu. Il faut ajouter le numéro (environ 1-5 €/mois), le coût éventuel des renvois facturé par 2L, et l'hébergement et la base déjà compris dans Lovable Cloud. L'IA passant par Lovable est déduite des crédits de l'espace de travail : à suivre dans le même budget. Pour un chiffre exact, il manque : le volume réel d'appels en débordement et hors ouverture (statistiques 2L), le modèle vocal choisi et son tarif du jour, la tarification des renvois 2L et la part d'appels transférés.

## 6. Difficultés et risques

- **RGPD et enregistrement** : il faut informer en début d'appel, définir la finalité et la base légale (intérêt légitime ou consentement), conserver 3 mois au maximum, limiter l'accès, permettre l'effacement, et mentionner le transfert vers le fournisseur IA (hébergement hors UE possible). Un avis du référent RGPD est conseillé avant d'activer l'enregistrement ; sans enregistrement, la transcription seule reste possible.
- **Numéro français réglementé** : le dossier de conformité Twilio est en examen. Si le numéro est refusé ou retardé, L7 est bloqué ; il faudra prévoir un justificatif d'adresse et d'entreprise.
- **2L** : un seul renvoi simultané aujourd'hui ; la transmission du numéro de l'appelant et du numéro appelé est annoncée mais non testée. Sans numéro de l'appelant, l'accueil est neutre et la reconnaissance impossible. Le SIP direct n'est pas possible.
- **Transferts** : le transfert part de Twilio vers une SDA, ce qui génère un appel sortant facturé et peut afficher un autre numéro chez le salarié ; à tester.
- **Qualité temps réel** : latence, interruptions, accents, noms et plaques mal compris ; d'où la relecture lettre par lettre et la confirmation.
- **Identité** : 1 386 numéros sont partagés et 54 homonymes existent entre les sites, d'où l'accueil neutre par défaut dans le doute. Aucune donnée n'est divulguée avant confirmation.
- **Confidentialité interne** : les messages personnels ou confidentiels ne doivent être visibles que par leur destinataire et la direction.
- **Budget** : la facturation des fournisseurs arrive en décalé, donc le plafond est une estimation interne. Il peut y avoir un léger dépassement, puisque les appels en cours ne sont jamais coupés.
- **Plateforme** : le relais voix temps réel tourne sur l'hébergement Lovable (Cloudflare) ; la faisabilité des connexions longues est à valider dès le début de L7.

## 7. Blocages indispensables uniquement

1. Approbation du numéro Twilio, puis test du renvoi 2L (numéro de l'appelant et numéro appelé transmis ? deux appels simultanés ?).
2. Décision RGPD sur l'enregistrement audio (activé à 3 mois ou transcription seule), avec le texte d'information.
3. Liste des destinataires front office de Castillon et des SDA des salariés transférables.
4. Choix du fournisseur de voix après un court comparatif (je peux le préparer dès le lancement de L6).

En attente de votre autorisation explicite avant tout développement. Aucun code, aucune donnée et aucune publication n'ont été modifiés.
