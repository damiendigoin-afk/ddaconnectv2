# Incident analyse des quatre pneus — 9 novembre 2026

## Cause démontrée

Les logs publiés à 10:33:16 et 10:33:25 UTC (11:33 Europe/Paris), ainsi qu'à 10:31, indiquent **Worker exceeded memory limit**, HTTP 502. L'identifiant de fonction `590003550973c7354df3ec9da7a789730b94ae5a89948271d36c001e9df6d347` correspond exactement au SHA-256 de `src/lib/tour-tire-analysis.functions.ts--analyzeTourTires_createServerFn_handler` (algorithme du compilateur TanStack).

Le handler téléchargeait les douze originaux, convertissait chacun en tableau d'octets puis chaîne binaire puis base64, conservait toutes les chaînes dans `content`, ensuite sérialisé en JSON par `runPaidAi`. La limite mémoire a donc été dépassée dans cette fonction ; le point exact d'allocation fatal n'est pas fourni par les logs.

Ce n'est pas une erreur de parsing IA démontrée : aucune entrée IA pour ces tentatives autour de 10:33. Un appel `tour_tires_global` antérieur à 10:28 avait réussi ; son journal sans `entity` ne permet pas de l'attribuer formellement à ce tour.

## Photos et données, vérification lecture seule

Tour AZ-665-QG, créé par Styven Guillou à Castillon à 10:25:15 UTC : `be30bf16-445a-46c3-bf87-eb71a80889fc`.

- Les 18 photos pneus (12 nécessaires + 6 reprises sur les roues arrière) ont toutes un objet de stockage correspondant.
- Les douze plus récentes par rôle totalisent **42 139 292 octets**, soit au moins **56 185 723 octets** en base64, avant les autres copies mémoire. Stockage : PNG malgré les chemins `.jpg` ; le correctif ne modifie ni leur format ni la capture.
- Le tour reste `draft`, `updated_at = 2026-11-09 10:33:08.376557+00`, 21 médias au total, dernière photo à 10:33:30.522137 UTC. Contrôle identique après l'analyse réelle.
- Aucun changement de points, véhicules, clients, statut/clôture, aucune suppression de photo. Le test réel écrit seulement le journal et cache IA habituels.

## Correctif ciblé

- `src/lib/tour-tire-analysis.functions.ts` : douze URL signées privées, durée 15 minutes, établies avec les droits du demandeur ; aucun téléchargement/base64 des originaux côté serveur. Même modèle, même prompt, même analyse groupée et photos HD. Tri déterministe par date puis ID. Logs par étape, tour, roue/rôle, statut, durée et erreur filtrée ; aucun contenu photo ni URL signée.
- `src/lib/tour-tire-analysis-error.ts` : message clair pour incidents réseau/serveur et filtrage des URL/jetons dans les diagnostics.
- `src/components/TourTiresAnalysis.tsx` : reprise d'un incident avec cache conservé ; réponse IA explicitement inexploitable permet toujours une relecture volontaire sans cache. Mode édition conserve son action de relecture volontaire. Pas de nouvel upload ni ressaisie.
- `src/routes/tour.$tourId.index.tsx` : contrôle des erreurs d'enregistrement des résultats initiaux, plus de succès silencieux après échec d'une roue. Reprise réécrit les mêmes points avec le résultat mis en cache.
- `src/lib/__tests__/tour-tire-analysis.server-test.ts` et `vitest.server.config.ts` : tests du vrai handler sans transformation en RPC, avec stockage/IA fictifs ; aucune écriture métier.
- `src/lib/__tests__/tour-tires-analysis-flow.test.tsx` : régression UI erreur générique et reprise sans validation automatique.
- `AGENTS.md`, `roadmap.md` : règles et suivi du correctif.

## Vérifications

1. Avant correctif : trois tests serveur échouaient sur le téléchargement d'originaux et l'exception de stockage non gérée.
2. Après correctif : ces trois tests passent (12 références, corps <20 Ko, zéro téléchargement ; échec stockage puis reprise ; empreinte identique/cache, aucune mutation).
3. Tests ciblés UI/analyse/groupes : **23/23**.
4. Suite standard : **1 396/1 396** ; tests serveur séparés : **3/3**.
5. Compilation automatique : `build OK` après modifications. Aucun build/typecheck manuel lancé.
6. Appel réel authentifié du seul handler sur les douze photos conservées : succès, quatre roues exploitables, trois photos par roue. Deuxième appel : succès **depuis le cache**. Aucune sauvegarde métier invoquée.

## Statut et limites

Correctif prêt à revoir, **non publié**. Aucune migration, configuration ou e-mail.

Le parcours complet jusqu'à la clôture n'a volontairement pas été exécuté sur ce tour réel. Les interactions sont couvertes par tests UI ; aucune recette téléphone réelle. Le succès de l'appel réel confirme que le service IA accepte les URL signées des originaux. La disparition des 502 dans le runtime publié ne pourra être vérifiée qu'après publication par le propriétaire. La reprise n'ajoute pas de verrou distribué entre appareils ; le cache existant évite les nouveaux appels après réussite, sans garantir l'unicité de deux requêtes strictement simultanées.