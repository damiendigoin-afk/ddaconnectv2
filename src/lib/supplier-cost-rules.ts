/**
 * Coût réel fournisseur — règles pures (testables).
 * Aucune de ces fonctions ne touche aux quantités physiques : seule la valorisation évolue.
 */
import { normalizeRef } from "@/lib/parts-rules";

/** Écart absolu toléré par ligne (en €) pour une validation automatique. */
export const PRICE_TOLERANCE_EUR = 1;

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Écart absolu de la ligne : |PU facture − PU de référence| × quantité. Null si pas de référence. */
export function lineGapAbs(qty: number, invoiceUnit: number, referenceUnit: number | null): number | null {
  if (referenceUnit == null) return null;
  return r2(Math.abs(invoiceUnit - referenceUnit) * Math.abs(qty));
}

export function withinTolerance(gap: number | null): boolean {
  return gap == null || gap <= PRICE_TOLERANCE_EUR;
}

/**
 * Correction de PAMP quand le coût d'une réception déjà entrée passe de oldCost à newCost.
 * Seule la part encore en stock (min(qty, stock)) est revalorisée ; la part déjà sortie
 * n'est pas « ré-entrée ». Aucune quantité n'est modifiée.
 */
export function pampAfterCostCorrection(
  onHand: number,
  pamp: number | null,
  qty: number,
  oldCost: number | null,
  newCost: number,
): number | null {
  if (onHand <= 0) return pamp;
  const base = pamp ?? newCost;
  const old = oldCost ?? base;
  const affected = Math.min(Math.max(qty, 0), onHand);
  if (affected === 0 || old === newCost) return pamp ?? r4(newCost);
  return r4(Math.max(0, (onHand * base + affected * (newCost - old)) / onHand));
}

/** Clé stable d'une ligne de facture : même document + même rang + même référence = même ligne. */
export function supplierLineKey(index: number, reference: string | null): string {
  return `${index}|${reference ? normalizeRef(reference) : "-"}`;
}

export function isCreditDoc(docKind: string | null | undefined, totalHt: number | null | undefined): boolean {
  const k = (docKind ?? "").toLowerCase();
  return k.includes("avoir") || k.includes("credit") || (totalHt != null && totalHt < 0);
}

export type ReceiptCandidate = {
  id: string;
  qty_received: number;
  reference_normalized: string | null;
  source_document_id: string | null;
  supplier_name: string | null;
  already_costed_by_other_doc: boolean;
};

const normName = (s: string | null) => (s ?? "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");

/**
 * Rapprochement certain uniquement : même référence, quantité identique, non encore
 * valorisée par une autre facture, et un seul candidat restant. Sinon null (rien n'est deviné).
 */
export function matchReceiptLine(
  line: { reference: string | null; qty: number },
  docId: string,
  supplierName: string | null,
  candidates: ReceiptCandidate[],
): string | null {
  if (!line.reference || !(line.qty > 0)) return null;
  const ref = normalizeRef(line.reference);
  let pool = candidates.filter((c) => c.reference_normalized === ref && !c.already_costed_by_other_doc && c.qty_received === line.qty);
  const sameDoc = pool.filter((c) => c.source_document_id === docId);
  if (sameDoc.length) pool = sameDoc;
  else if (supplierName) {
    const s = normName(supplierName);
    pool = pool.filter((c) => {
      const n = normName(c.supplier_name);
      return n !== "" && (n.includes(s) || s.includes(n));
    });
  }
  return pool.length === 1 ? pool[0].id : null;
}
