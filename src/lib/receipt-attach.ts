/**
 * Rattachement ultérieur d'une réception validée sans OR à l'OR courant de la même immatriculation.
 * Règles pures (testables) : jamais silencieux, jamais sur un OR historique, jamais de second receipt_in.
 */
import { normalizePlate } from "@/lib/plate";

export type OrphanReceipt = { id: string; site_id: string; plate: string | null; repair_order_id: string | null; status: string; cancelled_at?: string | null };

/** Réceptions validées du site, sans OR, non annulées, dont la plaque normalisée égale celle de l'OR. */
export function orphanReceiptsForPlate<T extends OrphanReceipt>(rows: T[], plate: string | null | undefined, siteId: string | null): T[] {
  const key = normalizePlate(plate ?? "");
  if (key.length < 5) return [];
  return rows.filter((r) => !r.repair_order_id && r.status !== "cancelled" && !r.cancelled_at && (!siteId || r.site_id === siteId) && normalizePlate(r.plate ?? "") === key);
}

export type AttachLine = { id: string; article_id: string | null; condition: string; qty_received: number; qty_allocated: number; repair_order_id: string | null; physical_reference: string | null; designation: string | null };

/** Quantité à affecter à l'OR par ligne : utilisable, article connu, non déjà affectée ailleurs. */
export function allocationPlan(lines: AttachLine[], orId: string): { line: AttachLine; qty: number }[] {
  return lines
    .filter((l) => l.condition === "usable" && l.article_id && (!l.repair_order_id || l.repair_order_id === orId))
    .map((l) => ({ line: l, qty: Math.max(0, Number(l.qty_received) - Number(l.qty_allocated || 0)) }))
    .filter((p) => p.qty > 0);
}

/** Un OR n'est proposé comme cible que s'il est l'OR ouvert par le mécanicien (officiel) — jamais un n° issu de l'historique WinMotor. */
export function canAttachTo(or: { id: string; or_number: string | null } | null | undefined): boolean {
  return !!(or?.id && or.or_number && or.or_number.trim());
}
