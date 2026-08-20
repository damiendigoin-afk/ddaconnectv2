# Diagnostic — photos manquantes dans le compte rendu / PDF

## Ce que montre le contrôle

Les photos sont bien enregistrées et bien reliées : sur 187 médias, tous ceux d'un tour (`inspections/`, `tours/`) ont un `inspection_id` renseigné (les 23 sans lien viennent des OR, hors sujet). La capture n'est donc pas en cause — le problème est dans l'affichage PDF.

## Causes identifiées (par ordre d'impact)

1. **Le PDF exclut volontairement des photos** — `src/routes/tour.$tourId.pdf.tsx` ne garde que `alertMedia` : photos rattachées à un point en « à surveiller / défaut » ou à une observation. Toute photo prise sur un point **OK**, sur le **compteur**, sur le **contrôle technique**, ou non rattachée à un point, disparaît du PDF. C'est la cause principale.
2. **Limite de 9 photos** — `alertMedia.slice(0, 9)` coupe silencieusement au-delà de 9 photos, même parmi les anomalies.
3. **Bucket privé + URL publique** — le bucket `dda-media` est privé (vérifié), or le PDF construit les images avec `getPublicUrl()`. Ces URLs renvoient une erreur : les images restent vides/cassées à l'impression. La vue écran, elle, utilise des URLs signées (`mediaUrl`) et s'affiche correctement — d'où l'écart écran/PDF constaté.
4. **Impression déclenchée trop tôt** — `window.print()` part sur un `setTimeout` de 600 ms sans attendre le chargement effectif des images ; sur connexion lente, le PDF sort avec des cadres vides.

## Correctifs recommandés

- Afficher **toutes** les photos du tour dans le PDF, groupées par point / observation, avec une section « autres photos » pour les non rattachées (compteur, CT, vue générale).
- Supprimer la limite à 9 (ou la remplacer par une pagination sur plusieurs pages A4).
- Remplacer `getPublicUrl` par des **URLs signées** (`createSignedUrl`, comme `src/lib/photo.ts`), résolues avant le rendu ; utiliser `thumb_path` quand il existe pour alléger le document.
- Attendre le chargement de toutes les images (`Promise.all` sur `img.decode()`) avant d'appeler `window.print()`, avec un délai de sécurité.

## Fichiers concernés

- `src/routes/tour.$tourId.pdf.tsx` — filtrage, limite, URLs, déclenchement de l'impression
- `src/lib/report.ts` — expose déjà tous les médias, pas de changement nécessaire
- `src/lib/photo.ts` — source des URLs signées à réutiliser
- `src/components/ReportView.tsx` — vue écran, déjà correcte (référence de comportement attendu)

Aucun code n'a été modifié : ce document est un diagnostic. Dis-moi si tu veux que j'applique les quatre correctifs.
