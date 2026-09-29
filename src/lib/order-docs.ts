/** Document source d'une commande : rattachement et ouverture par URL signée courte (accès contrôlé par site). */
import { supabase } from "@/integrations/supabase/client";
import { isStoragePath, orderLinkPatch, SIGNED_URL_TTL } from "@/lib/order-docs-rules";

const BUCKET = "dda-media";

/** Trace la commande sur le document (si non déjà rattaché ailleurs). Jamais d'effet sur le stock. */
export async function linkDocToOrder(docId: string, orderId: string): Promise<void> {
  const { data } = await supabase.from("inbox_documents").select("linked_kind, linked_id").eq("id", docId).maybeSingle();
  const patch = data ? orderLinkPatch(data, orderId) : null;
  if (patch) await supabase.from("inbox_documents").update({ ...patch, status: "traite" }).eq("id", docId);
}

/**
 * URL signée générée à la demande. Le stockage refuse la signature si l'utilisateur n'a pas accès
 * au site du document (policy storage_object_owned) : null => accès refusé.
 */
export async function orderDocSignedUrl(storagePath: string, download = false): Promise<string | null> {
  if (!isStoragePath(storagePath)) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL, download ? { download: true } : undefined);
  return error ? null : data?.signedUrl ?? null;
}
