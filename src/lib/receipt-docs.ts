/** Rattachement d'un BL / d'une facture à une réception déjà validée : aucun mouvement de stock, aucune nouvelle réception. */
import { supabase } from "@/integrations/supabase/client";
import { logEvent, type Actor } from "@/lib/parts";
import { readPurchaseDoc } from "@/lib/purchase-doc";
import { uploadSupplierDoc, type InvoiceExtract } from "@/lib/supplier-docs";
import { receiptDocKind, receiptDocWarnings, type AttachedDoc } from "@/lib/receipt-docs-rules";

export type ReceiptForDoc = {
  id: string; site_id: string; supplier_id: string | null; order_id: string | null; source_document_id: string | null;
  plate: string | null; supplier_name: string | null; or_number: string | null;
  lines: { physical_reference: string | null; qty_received: number }[];
};

export type ReceiptDocRow = AttachedDoc & { file_name: string; storage_path: string; linked_id: string | null };

/** Documents rattachés à ces réceptions (lien explicite + document d'origine). */
export async function listReceiptDocs(receipts: { id: string; source_document_id: string | null }[]): Promise<Map<string, ReceiptDocRow[]>> {
  const out = new Map<string, ReceiptDocRow[]>();
  if (!receipts.length) return out;
  const ids = receipts.map((r) => r.id);
  const srcIds = receipts.map((r) => r.source_document_id).filter((x): x is string => !!x);
  const cols = "id,status,extracted,file_name,storage_path,linked_id,linked_kind";
  const [{ data: linked }, { data: src }] = await Promise.all([
    supabase.from("inbox_documents").select(cols).eq("linked_kind", "part_receipt").in("linked_id", ids),
    srcIds.length ? supabase.from("inbox_documents").select(cols).in("id", srcIds) : Promise.resolve({ data: [] as never[] }),
  ]);
  for (const r of receipts) {
    const docs = new Map<string, ReceiptDocRow>();
    for (const d of [...(src ?? []), ...(linked ?? [])]) {
      if (d.id === r.source_document_id || (d.linked_kind === "part_receipt" && d.linked_id === r.id)) docs.set(d.id, { ...d, extracted: (d.extracted ?? {}) as InvoiceExtract });
    }
    out.set(r.id, [...docs.values()]);
  }
  return out;
}

/** Lecture (pipeline OCR commun) puis rattachement documentaire. Ne touche ni aux lignes ni au stock. */
export async function attachDocToReceipt(r: ReceiptForDoc, file: File, actor: Actor) {
  const read = await readPurchaseDoc(file);
  const x: InvoiceExtract = { ...read.extracted, ...(r.supplier_id && !read.extracted.supplier_id ? { supplier_id: r.supplier_id } : {}) };
  const kind = receiptDocKind(x);
  const doc = await uploadSupplierDoc({ file: read.file, extracted: x, siteId: r.site_id, userId: actor.userId, userName: actor.name });
  // Facture : reste « À vérifier » pour le contrôle facture ; BL : validé comme justificatif de réception.
  const { error } = await supabase.from("inbox_documents")
    .update({ linked_kind: "part_receipt", linked_id: r.id, status: kind === "facture" || kind === "avoir" ? "a_verifier" : "valide" })
    .eq("id", doc.id);
  if (error) throw error;
  if (!r.source_document_id) {
    const { error: e2 } = await supabase.from("part_receipts").update({ source_document_id: doc.id }).eq("id", r.id);
    if (e2) throw e2;
  }
  const warnings = receiptDocWarnings(r, x);
  await logEvent({ site_id: r.site_id, entity: "part_receipt", entity_id: r.id, action: "attach_document", detail: { document_id: doc.id, kind, document_number: x.document_number ?? x.invoice_number ?? x.delivery_note_number ?? null, warnings, stock_moved: false } }, actor);
  return { docId: doc.id, kind, warnings, readWarning: read.warning };
}
