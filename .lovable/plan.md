# Diagnostic production — 502 persistant après rollback

## Constat (vérifié le 08/10 à ~08:00 UTC)

- `https://ddaconnectv2.lovable.app/` → **HTTP 502, "Internal server error"**
- `https://ddaconnectv2.lovable.app/auth` → **HTTP 502, "Internal server error"**

Le rollback de `@lovable.dev/vite-tanstack-config` vers 2.23.1 suivi d'une republication **n'a pas suffi** : la production plante toujours au démarrage du serveur, avant l'authentification et la base de données.

## Hypothèses restantes

1. La republication n'a pas réellement utilisé la version 2.23.1 (cache de build, lockfile non pris en compte côté plateforme).
2. La cause n'est pas (ou pas seulement) la version de l'outil de build : un autre changement récent casse le démarrage du serveur en production alors que le preview fonctionne.
3. Incident côté plateforme d'hébergement indépendant du code.

## Plan d'action proposé

1. Comparer le dernier déploiement production fonctionnel avec l'actuel : liste exacte des versions d'outils effectivement utilisées au build (pas seulement package.json).
2. Vérifier que le lockfile publié correspond bien à 2.23.1 et qu'aucune autre dépendance de build n'a bougé entre le dernier déploiement sain et maintenant.
3. Tester un build de production en local avec exactement les mêmes versions pour reproduire le crash de démarrage et obtenir la trace d'erreur complète.
4. Si le crash est reproduit : identifier le module fautif et appliquer le correctif minimal (sans toucher aux correctifs métier jusqu'au commit CAZES).
5. Si non reproduit en local : conclure à un problème plateforme et ouvrir un ticket support Lovable avec les horaires et codes d'erreur relevés.
6. En dernier recours : republier la dernière version production connue comme fonctionnelle (avant le commit du 07/10), quitte à perdre temporairement les derniers correctifs métier, le temps de diagnostiquer.

Aucune modification de code ou de base n'est faite sans votre accord.
