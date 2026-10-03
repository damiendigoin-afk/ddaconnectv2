/**
 * Anti-doublon des commandes fournisseur — miroir pur du trigger
 * guard_part_order_duplicate (migration 0040).
 * Doublon certain = même site + même destination + même cible logique, et
 * (même document source) ou (même fournisseur + même n° commande fournisseur).
 * Cible logique : OR DDA > n° de dossier demandé > plaque normalisée > neutre.
 * Une même référence fournisseur sur un autre OR reste autorisée (multi-OR).
 */
export type OrderKey = {
  site_id: string;
  destination: string | null;
  supplier_id: string | null;
  supplier_order_ref: string | null;
  source_document_id: string | null;
  repair_order_id: string | null;
  requested_or_number: string | null;
  plate: string | null;
};

export type ExistingOrder = OrderKey & { id: string; status: string; created_at?: string | null };

export const DUPLICATE_ORDER_MESSAGE = "Commande déjà enregistrée";

export function orderTarget(o: Pick<OrderKey, "repair_order_id" | "requested_or_number" | "plate">): string {
  if (o.repair_order_id) return `ro:${o.repair_order_id}`;
  const or = (o.requested_or_number ?? "").trim().toUpperCase();
  if (or) return `or:${or}`;
  const plate = (o.plate ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (plate) return `plate:${plate}`;
  return "none";
}

const ref = (v: string | null) => (v ?? "").trim() || null;

export function isDuplicateOrder(candidate: OrderKey, existing: ExistingOrder): boolean {
  if (existing.status === "cancelled") return false;
  if (existing.site_id !== candidate.site_id) return false;
  if ((existing.destination ?? null) !== (candidate.destination ?? null)) return false;
  if (orderTarget(existing) !== orderTarget(candidate)) return false;
  if (candidate.source_document_id && existing.source_document_id === candidate.source_document_id) return true;
  const r = ref(candidate.supplier_order_ref);
  return Boolean(r && candidate.supplier_id && existing.supplier_id === candidate.supplier_id && ref(existing.supplier_order_ref) === r);
}

export function findDuplicateIn<T extends ExistingOrder>(candidate: OrderKey, rows: T[]): T | null {
  return rows.find((row) => isDuplicateOrder(candidate, row)) ?? null;
}

/** Erreur utilisateur propre (jamais le message PostgreSQL brut). */
export class DuplicateOrderError extends Error {
  constructor(public existingId: string | null) {
    super(DUPLICATE_ORDER_MESSAGE);
    this.name = "DuplicateOrderError";
  }
}

/** Reconnaît le refus du trigger : « DUPLICATE_PART_ORDER:<id> ». */
export function duplicateIdFromDbError(message: string | null | undefined): string | null | undefined {
  const m = /DUPLICATE_PART_ORDER:([0-9a-f-]{36})?/i.exec(message ?? "");
  return m ? (m[1] ?? null) : undefined;
}
