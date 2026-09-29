/**
 * Document source d'une commande fournisseur — règles pures (testables).
 * Stockage : original unique dans le bucket privé dda-media (`fournisseurs/…`), métadonnées dans inbox_documents
 * (storage_path, file_name, mime_type, file_size, content_hash, created_at) ; part_orders.source_document_id pointe dessus.
 * Aucun contenu binaire/base64 en base.
 */
export type OrderSourceDoc = { id: string; storagePath: string; fileName: string; mimeType: string | null; size: number | null; createdAt: string | null };

type DocRow = { id?: string | null; storage_path?: string | null; file_name?: string | null; mime_type?: string | null; file_size?: number | null; created_at?: string | null } | null | undefined;

/** Document source exploitable d'une commande, sinon null (=> pas de bouton). */
export function orderSourceDoc(o: { source_document_id?: string | null; inbox_documents?: DocRow }): OrderSourceDoc | null {
  const d = o.inbox_documents;
  if (!o.source_document_id || !d?.storage_path || !isStoragePath(d.storage_path)) return null;
  return { id: d.id ?? o.source_document_id, storagePath: d.storage_path, fileName: d.file_name || "document", mimeType: d.mime_type ?? null, size: d.file_size ?? null, createdAt: d.created_at ?? null };
}

/** Chemin objet valide du stockage fournisseur (jamais une data: URL / base64 / URL publique). */
export const isStoragePath = (p: string) => /^fournisseurs\/[A-Za-z0-9._-]+$/.test(p);

/** Métadonnées d'un document : doivent rester légères, sans contenu. */
export function metadataHasNoContent(row: Record<string, unknown>): boolean {
  return Object.values(row).every((v) => typeof v !== "string" || (v.length < 2048 && !/^data:|;base64,/i.test(v)));
}

/** Durée des URL signées (s) : courte, générée à la demande. */
export const SIGNED_URL_TTL = 300;

/** Rattachement d'un document à une commande : ne remplace jamais un rattachement existant (réception, OR…). */
export function orderLinkPatch(doc: { linked_kind: string | null; linked_id: string | null }, orderId: string) {
  return doc.linked_kind || doc.linked_id ? null : { linked_kind: "part_order", linked_id: orderId };
}

/**
 * Nettoyage : un fichier n'est supprimable que s'il n'est plus référencé par aucun document.
 * Les commandes annulées gardent leur document (historique conservé) : jamais de suppression à l'annulation.
 */
export function canDeleteStorageObject(path: string, referencingDocIds: string[]): boolean {
  return isStoragePath(path) && referencingDocIds.length === 0;
}
