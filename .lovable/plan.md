# Diagnostic « Too many connections issued to the database » — Réception pièces

## Cause probable (confirmée par les logs)
Ce n'est pas la base de données ni une fuite de connexions dans le code : c'est le **service de stockage de fichiers** qui a refusé l'envoi du PDF AUTODOC (HTTP 429), et l'écran affiche tel quel son message d'erreur.

## Preuves
- Journaux du stockage, 13/10/2026 10:54:07 UTC : `POST 429 /object/dda-media/fournisseurs/c12fd03d-e522-480b-b09d-3700a94ceebe.pdf` (Chrome Windows). C'est la **seule** erreur ≥ 429 des dernières 24 h sur toute l'API.
- Le fichier n'existe pas dans le stockage : l'envoi n'a pas abouti, aucune fiche document créée derrière.
- Journaux Postgres (6 h) : aucune erreur « too many connections ». Aucune réponse 5xx de l'API sur 3 h.
- État actuel : 14/60 connexions (faible), pooler 1/200, aucune alerte de saturation sur 48 h. Connexions : 10 PostgREST inactives, services internes ; aucune connexion applicative directe.
- Code : aucun `postgres(...)`, `new Pool`, `drizzle(...)` dans `src/` (les paquets `postgres`/`drizzle-orm` sont installés mais inutilisés ; `drizzle.config.ts` sert uniquement aux migrations). Seuls `createClient` serveur : `expertise-email.server.ts`, `report-email.server.ts` (e-mails, hors réception).
- Changements récents (correctif SSR, statut réceptions directes, approvisionnement) : uniquement le client navigateur habituel, aucun accès base direct ajouté.

## Chemin concerné
`/pieces-achats/reception` → lecture BL → `src/lib/receipt-docs.ts:42` → `uploadSupplierDoc` (`src/lib/supplier-docs.ts:160`) → `supabase.storage.upload("fournisseurs/<uuid>.pdf")` → 429 → `throw up.error` → toast brut.

## Classification
- Fuite de connexions dans le code : **non**.
- Trop de requêtes concurrentes depuis l'écran : **non démontré** (une seule requête refusée).
- Limite plateforme : **oui, ponctuelle** — le pool interne du service de stockage a été momentanément saturé côté plateforme.
- Pooler mal configuré : **non**.

## Correctif minimal recommandé (non appliqué)
1. Dans `uploadSupplierDoc` : si l'envoi renvoie 429/503 ou « Too many connections », réessayer 2 fois (pause ~1 s puis ~3 s), même chemin, `upsert: false`. Aucun effet de bord : rien n'est écrit avant un envoi réussi.
2. En cas d'échec final, toast compréhensible : « Le serveur de fichiers est momentanément saturé, réessayez dans quelques secondes. Rien n'a été enregistré. »
3. Test unitaire : 429 puis succès ⇒ document créé une seule fois ; 3 × 429 ⇒ erreur claire, aucune fiche `inbox_documents`.
4. Facultatif : appliquer la même aide à `src/lib/photo.ts` et `src/lib/documents.ts`.

Action immédiate pour l'utilisateur : refaire simplement la réception avec le même PDF (anti-doublon par empreinte, aucun risque de double enregistrement).

Attente de validation, aucune modification.
