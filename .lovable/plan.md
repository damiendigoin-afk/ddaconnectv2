# DDA Assistant — Phase 1 : plan de réalisation par lots

Plan uniquement. Rien n'est codé, migré, connecté ni publié tant que le lancement n'est pas validé explicitement, lot par lot. Socle commun Messenger + voix (un seul projet).

## Décisions acquises (rappel)

- Messenger Castillon : offre nettoyage intérieur/extérieur + bilan hiver offert, 39 € TTC, 1 h. Créneaux lun-ven 8-12 / 14-18, au moins 4 jours ouvrés, fériés français et jours non ouvrés exclus. RDV promotionnel confirmé automatiquement ; fiche DDA + e-mail à Delphine, Marc, Frédéric uniquement. Modification/annulation dans la conversation avec nouveau récapitulatif, notification et e-mail. Question non résolue = alerte « Intervention nécessaire » suivie jusqu'à résolution. Garde-fou : un créneau déjà pris par l'IA n'est plus proposé.
- Offre identifiée par le contexte de campagne Meta (ref / referral) ; sans contexte, question simple ; jamais déduite du texte ; campagne expirée jamais proposée.
- Voix : appels uniquement renvoyés par le standard 2L ; scénario unique ; étiquette « débordement » (lun-ven 8-12 / 14-18 hors fériés) ou « hors ouverture / appel de nuit » (tout le reste, dont 12h-14h). Aucun transfert.
- Identité appelant : accueil nominatif seulement si correspondance unique et fiable, sinon neutre ; confirmation toujours ; rien du dossier divulgué avant confirmation ; aucune fusion automatique.

## Nouvelle règle : deux natures de demande

| Nature | Exemples | Traitement |
|---|---|---|
| RDV promotionnel auto-confirmable | Campagne active avec offre, prix, durée, conditions à jour (ex. nettoyage 39 €) | Confirmé par l'IA sur un créneau valide |
| Demande technique / devis / carrosserie / dépannage / prix inconnu | Entretien, panne, sinistre, demande de prix, maintenance connectée | Fiche « Demande à valider » + alerte ; l'IA collecte et reformule, ne confirme ni date, ni prix, ni durée tant qu'aucun planning réel n'existe |

Aucun ancien prix, forfait, promotion ou garantie n'est repris sans source à jour (campagne active versionnée ou réglage daté). Prix inconnu = « un conseiller vous envoie un devis ».

## Scripts de référence (7)

Statut : **non reçus dans ce projet** (aucun des fichiers joints ne correspond aux scripts). Bloquant pour finaliser le lot B ; à fournir (PDF, photos ou texte) : prise de RDV standard, maintenance connectée (2 pages), sortie dépannage, EAD carrosserie, demande de prix par téléphone (2 versions), mémo objections MAEVA.

Logiques à extraire dès réception, sous forme de blocs de dialogue réutilisables :
1. Accueil et qualification de l'objet.
2. Immatriculation (relue, `strictPlate`) et kilométrage (`measure.ts`).
3. Coordonnées : nom, prénom, adresse, CP, ville, e-mail, téléphone.
4. Disponibilités du client.
5. Durée d'immobilisation annoncée seulement si connue par une source à jour.
6. Mobilité (véhicule de prêt, navette) seulement si la disponibilité est vérifiable ; sinon « le garage vous confirmera ».
7. Reformulation et confirmation.
8. Demande de prix : prix connu et à jour, sinon renvoi devis.
9. Carrosserie : sinistre ou non, assureur, n° de sinistre, expertise (EAD) prévue ou non, photos facultatives.
10. Dépannage : sécurité d'abord, localisation, assistance du contrat, aucune promesse de délai.
11. Objections (MAEVA) : réponses courtes autorisées, sinon escalade.

## Lots

### A — Schéma commun et contrôle d'accès (réalisable maintenant)
Tables `site_id` + RLS par site (via `user_can_access_site`) + GRANT : canaux, contacts canal, conversations, messages (id externe unique), demandes (nature promo/technique, statut), RDV + historique, alertes « Intervention nécessaire » + historique, campagnes versionnées, rattachements identité (journal), index téléphones, notifications + destinataires, réglages, journal d'appels (préparé, vide). Module `assistant` dans le registre des droits.
Recette : un salarié Lalinde ne lit aucune ligne Castillon ; un non-titulaire du module ne voit pas l'écran ; id externe dupliqué refusé ; deux RDV IA actifs sur le même créneau refusés.

### B — Moteur de règles et scripts métier (réalisable maintenant ; finalisation après réception des scripts)
Logique pure testée : calendrier (fériés FR dont Pâques, Ascension, Pentecôte ; 4 jours ouvrés ; étiquette horaire), créneaux, nature de demande, blocs de dialogue (liste ci-dessus), validation des champs, choix de l'offre selon campagne, règles « jamais d'ancien prix ».
Recette : vendredi 10/10 → premier créneau mardi 16/10 ou plus tard selon le décompte confirmé ; 11/11 et samedi jamais proposés ; 12:30 = hors ouverture ; demande de prix sans prix à jour → renvoi devis ; demande carrosserie → fiche à valider avec assureur/sinistre.

### C — Moteur Messenger + campagne Meta (code faisable maintenant ; connexion réelle bloquée)
Webhook signé, idempotent ; captation ref/referral ; conversation (consentement → offre → créneau → coordonnées → véhicule → récapitulatif) ; modification/annulation ; escalade ; notifications DDA + e-mails. IA via la passerelle Lovable pour extraire le texte libre ; prix/horaires injectés depuis les réglages.
Bloqué par : app Meta, accès admin de la Page Castillon, revue `pages_messaging`, e-mails des trois destinataires.
Recette : voir « Critères de recette » ci-dessous.

### D — Index de reconnaissance des numéros (partiel maintenant)
Maintenant : normalisation E.164, index alimenté depuis les clients déjà importés (`customer_contacts.normalized_value`), score et règles d'accueil, repli neutre.
Bloqué : nouvelle commande d'export contacts sur l'automate WinMotor (serveur Chantal) — faisabilité à confirmer.
Recette : numéro unique fiable → nom proposé ; numéro partagé par 2 clients, fixe d'entreprise ou masqué → neutre ; index indisponible → neutre sans attente ; aucun nom faux annoncé sur les jeux de test.

### E — Interface DDA minimaliste (réalisable maintenant)
Écran « Assistant » : demandes et conversations (filtres RDV / à valider / alertes / appels), fiche avec historique et suivi jusqu'à « résolue », réglages (horaires, destinataires, questions autorisées, campagnes en lecture), connexions (état Meta, téléphonie, IA). Aucun créateur d'offres.
Recette : une alerte passe ouverte → en cours → résolue avec auteur et date ; un RDV annulé reste visible et barré.

### F — Adaptateur vocal Twilio (bloqué)
Préalables : numéro Twilio +33973921023 approuvé et acheté (dossier en revue) ; test de renvoi 2L vers ce numéro externe ; vérification par appels test que le numéro appelant et le numéro appelé arrivent bien ; capacité actuelle 1 appel renvoyé à la fois (devis 2L pour 2-3 en cours). SIP direct impossible.
Contenu : webhook d'appel, voix temps réel, même moteur que Messenger, accueil conditionnel, collecte, demande de rappel, journal d'appel, pas d'audio stocké, coupure/reprise, durée max et budget.
Recette : appel renvoyé à 12:30 → étiquette hors ouverture, même dialogue qu'à 10:30 ; second appel simultané → comportement du standard (occupé/messagerie) documenté ; numéro appelant absent → accueil neutre.

## Réalisable maintenant vs bloqué

| Lot | Maintenant | Bloqué par |
|---|---|---|
| A | Tout | — |
| B | Calendrier, créneaux, nature, champs | Scripts (7) pour les blocs de dialogue définitifs |
| C | Moteur, webhook, tests simulés | App Meta, Page, revue, e-mails destinataires, campagne active |
| D | Index depuis données DDA, règles | Export automate WinMotor |
| E | Tout | — |
| F | Rien | Numéro Twilio, test 2L, caller ID |

## Critères de recette Messenger (C)
- Referral de la campagne nettoyage active → offre 39 € TTC, 1 h, bilan hiver offert ; version figée sur la fiche.
- Sans contexte → question simple ; aucune promo supposée ; campagne expirée → non proposée.
- Réservation complète → une fiche RDV, un e-mail aux trois destinataires, un récapitulatif client.
- Message relivré → aucun doublon ; deux réservations simultanées du même créneau → une seule confirmée.
- Modification → même fiche, historique, récapitulatif, notification + e-mail ; annulation → créneau libéré, idem.
- Demande technique ou de prix inconnu → fiche « à valider », aucune date ni prix promis.
- Aucune collecte avant consentement.

## Tests pilotes et ordre de mise en service
1. A + B + E en interne (données de test, aucun canal).
2. C en mode test Meta avec 2-3 comptes internes (Page non publique ou testeurs).
3. Pilote Messenger réel Castillon 2 semaines, campagne unique, revue quotidienne des fiches.
4. D : index depuis DDA, puis export automate si validé.
5. F : après numéro approuvé et test 2L ; pilote sur plage hors ouverture (nuits/week-ends) d'abord, puis débordement.
6. Lalinde : paramétrage des destinataires et activation séparée.

## Crédits Lovable (fourchettes indicatives)

| Lot | Crédits |
|---|---|
| A — Schéma + droits | 10 – 18 |
| B — Règles + blocs de scripts + tests | 12 – 24 |
| C — Messenger + campagnes + notifications | 22 – 40 |
| D — Index numéros (partie DDA) | 6 – 12 |
| E — Interface minimaliste | 12 – 22 |
| Consentement / RGPD / purge | 4 – 8 |
| Recette pilote Messenger | 8 – 20 |
| **Phase 1 (A-E)** | **≈ 74 – 144** |
| D bis — export automate (côté DDA) | 5 – 12 |
| F — Voix Twilio + recette | 40 – 85 |

Exploitation (hors Lovable, à confirmer) : Messenger gratuit ; IA texte quelques centimes par conversation ; Twilio numéro FR ≈ 1–3 €/mois + minutes ≈ 0,01–0,03 €/min ; voix IA temps réel ≈ 0,05–0,30 €/min ; coût éventuel 2L pour renvois simultanés.

## À confirmer
1. Envoi des 7 scripts (bloquant pour B définitif).
2. E-mails de Delphine, Marc, Frédéric.
3. Accès Meta : app, admin Page Castillon, type d'annonce (Click-to-Messenger / lien m.me), dates de la campagne nettoyage.
4. Décompte des 4 jours ouvrés (jour du message inclus ou non) ; fermetures exceptionnelles ; délai limite de modification/annulation.
5. Automate WinMotor : export des contacts possible, fréquence.
6. Twilio : date d'approbation du numéro ; 2L : date du test de renvoi et réponse sur les devis 2-3 appels.
7. Textes RGPD et durées de conservation ; transcription voix autorisée ou non.
8. Questions simples autorisées et réponses aux objections validées.
