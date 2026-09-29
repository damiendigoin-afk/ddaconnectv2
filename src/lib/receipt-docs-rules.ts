/**
 * Documents rattachés après coup à une réception existante (règles pures, testables).
 * Enrichissement documentaire uniquement : jamais de mouvement de stock, jamais de nouvelle réception.
 */
import { normalizePlate } from "@/lib/plate";
import type { InvoiceExtract } from "@/lib/supplier-docs";

export type ReceiptDocKind = "bl" | "facture" | "avoir" | "autre";
export type ReceiptDocState = "awaiting" | "doc_received" | "invoice_to_check" | "none";

export type AttachedDoc = { id: string; status: string; extracted: InvoiceExtract | null };

export function receiptDocKind(x: InvoiceExtract | null | undefined): ReceiptDocKind {
  const k = (x?.doc_kind ?? "").toLowerCase();
  if (/avoir|credit/.test(k)) return "avoir";
  if (/fact|invoice/.test(k) || (!!x?.invoice_number && !x?.delivery_note_number)) return "facture";
  if (/bl|livraison|delivery/.test(k) || !!x?.delivery_note_number) return "bl";
  return "autre";
}

export const DOC_KIND_LABEL: Record<ReceiptDocKind, string> = { bl: "BL", facture: "Facture", avoir: "Avoir", autre: "Document" };

/** État documentaire d'une réception : « En attente » seulement tant qu'aucun justificatif n'est rattaché. */
export function receiptDocState(r: { receipt_type: string; source_document_id: string | null; status: string }, docs: AttachedDoc[]): ReceiptDocState {
  if (r.status === "cancelled") return "none";
  const invoices = docs.filter((d) => receiptDocKind(d.extracted) === "facture");
  if (invoices.some((d) => d.status === "non_traite" || d.status === "a_verifier")) return "invoice_to_check";
  if (docs.length || r.source_document_id) return r.receipt_type === "physical_without_document" ? "doc_received" : "none";
  return r.receipt_type === "physical_without_document" ? "awaiting" : "none";
}

/** Contrôle de cohérence document ↔ réception (avertissements seulement, jamais bloquant). */
export function receiptDocWarnings(
  r: { supplier_name: string | null; or_number: string | null; plate: string | null; lines: { physical_reference: string | null; qty_received: number }[] },
  x: InvoiceExtract,
): string[] {
  const w: string[] = [];
  const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (x.supplier && r.supplier_name) {
    const a = norm(x.supplier), b = norm(r.supplier_name);
    if (a && b && !a.includes(b.slice(0, 6)) && !b.includes(a.slice(0, 6))) w.push(`Fournisseur lu « ${x.supplier} » ≠ réception « ${r.supplier_name} »`);
  }
  if (x.or_number && r.or_number && norm(x.or_number) !== norm(r.or_number)) w.push(`OR lu ${x.or_number} ≠ OR de la réception ${r.or_number}`);
  if (x.plate && r.plate && normalizePlate(x.plate) !== normalizePlate(r.plate)) w.push(`Immatriculation lue ${x.plate} ≠ ${r.plate}`);
  const docRefs = new Map((x.lines ?? []).filter((l) => l.reference).map((l) => [norm(l.reference), l.quantity]));
  if (docRefs.size) {
    for (const l of r.lines) {
      const k = norm(l.physical_reference);
      if (!k) continue;
      if (!docRefs.has(k)) w.push(`Référence ${l.physical_reference} absente du document`);
      else { const q = docRefs.get(k); if (q != null && Number(q) !== Number(l.qty_received)) w.push(`Quantité ${l.physical_reference} : document ${q}, reçu ${l.qty_received}`); }
    }
  }
  return w;
}
