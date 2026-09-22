# Tours de véhicule — septembre 2026 : cause de l'écart

## Ce que montrent les données

Sur septembre 2026, 50 tours terminés (non archivés) existent réellement :

| Site | Compagnon | Tours |
|---|---|---|
| Castillon | Styven Guillou | 12 |
| Castillon | Erwann Pichard | 8 |
| Castillon | Louis Hustache | 1 |
| Castillon | Kylian Akrib | 1 |
| Castillon | Hugo Paolozzi | 1 |
| Damien Digoin Automobile | Allan Marchal | 11 |
| Damien Digoin Automobile | Dominique Chataigner | 6 |
| Damien Digoin Automobile | Julien Cordonnier | 1 |
| *(aucun site enregistré)* | Romain Nicolas | 7 |
| *(aucun site enregistré)* | Damien Digoin | 2 |

Total : 23 Castillon + 18 Damien Digoin Automobile + 9 sans site.

## Cause exacte

Il n'y a **aucun problème de statut ni de date** : tous ces tours sont bien `completed`, non archivés, avec une date de fin et un compagnon renseignés.

1. **Les 18 affichés = exactement le site « Damien Digoin Automobile »** (11 + 6 + 1). La page filtre la liste sur le site actif ; Styven et Erwann travaillent sur Castillon, donc ils disparaissent tant que le site affiché n'est pas Castillon. Le comportement est « normal » au sens du code, mais l'écran n'indique nulle part que le tableau est limité à un site.
2. **9 tours de septembre n'ont aucun site enregistré** (Romain Nicolas 7, Damien Digoin 2). Ceux-là sont invisibles dans *toutes* les vues par site, et n'apparaissent qu'en vue groupe. Même situation en août (5 tours sans site). C'est une vraie anomalie d'enregistrement à part.

## Ce que je propose de faire ensuite (rien n'est encore modifié)

1. Afficher clairement le périmètre au-dessus du tableau : « Site : Castillon » ou « Tous les sites », pour que l'écart ne soit plus ambigu.
2. Faire apparaître les tours sans site sur une ligne explicite « Site non renseigné » plutôt que de les faire disparaître silencieusement, avec le détail des compagnons concernés.
3. Chercher pourquoi certains tours partent sans site (probable création depuis un écran qui ne transmet pas le site actif) et corriger la création, puis rattacher les tours existants au bon site après validation de votre part.

## Détails techniques

- `src/lib/stats.ts` → `fetchCompletedToursInRange` : filtre `status = completed`, `archived_at is null`, bornes sur `completed_at`. Correct.
- `src/routes/statistiques.tours.tsx` → `scopedTours` filtre `t.site_id === activeSite` hors vue groupe : c'est ce filtre qui masque Castillon et écarte définitivement `site_id = null`.
- Aucun autre champ (`finished_at`, `started_at`, `completed_by`) n'intervient dans l'exclusion.
