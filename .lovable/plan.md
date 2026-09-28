# Erreur « new row violates row-level security policy » — dépôt de BL (Adrien Benoist, Castillon)

## Diagnostic (lecture seule)

1. **Ce qui échoue** : ce n'est pas une table de Pièces & achats. C'est l'**envoi du fichier** (photo ou PDF du BL) dans le stockage `dda-media`. L'application le range sous `fournisseurs/<uuid>.<ext>` (src/lib/supplier-docs.ts, `uploadSupplierDoc`). L'envoi se fait avant l'insertion `inbox_documents`, et l'erreur arrive à ce moment-là.
2. **Règle qui bloque** : `dda_media_insert` sur le stockage appelle `storage_object_owned(name, uid)`. Cette fonction n'autorise que les dossiers `inspections`, `tours`, `expertises`, `orders` et `notes-frais`. Tous les autres dossiers passent par `ELSE has_role(uid,'manager')`. Le dossier `fournisseurs/` n'est donc accessible qu'aux managers.
3. **Profil d'Adrien : il est cohérent.** Statut active, site Castillon, `site_scope=site`, entrée `user_sites` Castillon, rôle `salarie`, module `magasin` accordé. Les règles des tables sont vérifiées (`inbox_documents` : utilisateur actif ; `part_receipts`, `stock_movements`, `supplier_cost_lines` : utilisateur actif et site accessible) et elles l'autorisent toutes sur Castillon. Rien n'est à corriger sur son compte.
4. **Autres utilisateurs** : les **19 utilisateurs actifs non-manager** sont tous touchés. Le même blocage touche aussi, pour les non-managers, d'autres dossiers du même stockage : `magasin/`, `returns/`, `winmotor-imports/`, `emails/`, `carrosserie/`, `cases/`, `ads/`, `productivite/`. Les envois faits par le serveur avec les droits complets (`returns-workflow`, `emails/`) ne sont pas bloqués.

## Correction minimale recommandée

Une migration ajoute la branche suivante à `storage_object_owned`, sans rien retirer :

```text
WHEN 'fournisseurs' THEN (
  has_role(uid,'manager')
  OR EXISTS (SELECT 1 FROM inbox_documents d
             WHERE d.storage_path = _name
               AND (d.site_id IS NULL OR user_can_access_site(uid, d.site_id)))
  OR NOT EXISTS (SELECT 1 FROM inbox_documents d WHERE d.storage_path = _name)  -- envoi initial
)
```

Avec cette branche, un utilisateur actif peut envoyer un nouveau fichier fournisseur. Il ne peut relire que les fichiers liés à un document d'un site auquel il a accès. Le contrôle « utilisateur actif » existant reste en tête de la fonction.

En option, dans une seconde étape à valider : ajouter des branches équivalentes pour `magasin/`, `returns/`, `carrosserie/`, `cases/` et `winmotor-imports/` si ces écrans doivent fonctionner pour les non-managers.

## Vérification après correction

- Se connecter comme un non-manager sur Castillon, déposer un BL : le document est créé, sans erreur.
- Vérifier que ce non-manager ne peut pas ouvrir un BL d'un site non autorisé.
- Aucun changement du code de l'application, ni de Notes de frais.
