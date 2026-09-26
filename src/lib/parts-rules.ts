/**
 * Règles pures Pièces & achats / atelier (V3 Phase B). Aucune dépendance réseau : testables.
 * Réalité physique ≠ documents financiers : seuls ces mouvements font bouger le stock.
 */
export type MovementType =
  | "receipt_in"
  | "allocate_to_or"
  | "deallocate_from_or"
  | "supplier_return_out"
  | "manual_adjustment"
  | "damaged_quarantine"
  | "store_sale_final"
  | "or_sale_final";

export type Deltas = { delta_available: number; delta_allocated: number; delta_quarantine: number };

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  receipt_in: "Réception",
  allocate_to_or: "Affectation OR",
  deallocate_from_or: "Retour en stock (désaffectation)",
  supplier_return_out: "Retour fournisseur",
  manual_adjustment: "Correction manuelle",
  damaged_quarantine: "Reçue endommagée / à vérifier",
  store_sale_final: "Vente comptoir (Phase C)",
  or_sale_final: "Facturée sur OR (Phase C)",
};

/**
 * Effet d'un mouvement sur les compteurs. `qty` est positive sauf pour manual_adjustment (signée).
 * supplier_return_out sort de la quarantaine si `fromQuarantine`, sinon du disponible.
 */
export function movementDeltas(type: MovementType, qty: number, opts: { fromQuarantine?: boolean } = {}): Deltas {
  const z = { delta_available: 0, delta_allocated: 0, delta_quarantine: 0 };
  switch (type) {
    case "receipt_in":
      return { ...z, delta_available: qty };
    case "allocate_to_or":
      return { ...z, delta_available: -qty, delta_allocated: qty };
    case "deallocate_from_or":
      return { ...z, delta_available: qty, delta_allocated: -qty };
    case "supplier_return_out":
      return opts.fromQuarantine ? { ...z, delta_quarantine: -qty } : { ...z, delta_available: -qty };
    case "manual_adjustment":
      return { ...z, delta_available: qty };
    case "damaged_quarantine":
      return { ...z, delta_quarantine: qty };
    case "store_sale_final":
      return { ...z, delta_available: -qty };
    case "or_sale_final":
      return { ...z, delta_allocated: -qty };
  }
}

export type Level = { available: number; allocated: number; quarantine: number };

export function applyMovements(start: Level, moves: Deltas[]): Level {
  return moves.reduce(
    (l, m) => ({
      available: l.available + m.delta_available,
      allocated: l.allocated + m.delta_allocated,
      quarantine: l.quarantine + m.delta_quarantine,
    }),
    start,
  );
}

/** PAMP : moyenne pondérée sur la quantité physique déjà détenue (dispo + affectée). */
export function nextPamp(onHand: number, pamp: number | null, qty: number, unitCost: number | null): number | null {
  if (unitCost == null || !(qty > 0)) return pamp;
  if (pamp == null || onHand <= 0) return round4(unitCost);
  return round4((onHand * pamp + qty * unitCost) / (onHand + qty));
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}

export function normalizeRef(ref: string): string {
  return ref.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export type LineStatus = "ordered" | "partial" | "received";

export function orderLineStatus(ordered: number | null, received: number): LineStatus {
  if (received <= 0) return "ordered";
  if (ordered == null) return "received";
  return received >= ordered ? "received" : "partial";
}

export function orderStatus(lines: { status: string; line_kind?: string }[], anyReceipt: boolean): LineStatus {
  const parts = lines.filter((l) => (l.line_kind ?? "part") === "part");
  if (parts.length === 0) return anyReceipt ? "received" : "ordered";
  if (parts.every((l) => l.status === "received")) return "received";
  if (parts.some((l) => l.status !== "ordered") || anyReceipt) return "partial";
  return "ordered";
}

export function isOverReceipt(expected: number | null, received: number): boolean {
  return expected != null && received > expected;
}

export type Completeness =
  | { kind: "none" }
  | { kind: "unknown" }
  | { kind: "complete" | "incomplete"; done: number; total: number };

/** Résumé « PIÈCES COMPLÈTES X/X » à partir des lignes commandées connues. */
export function partsCompleteness(input: {
  simplifiedWithoutLines: number;
  lines: { qty_ordered: number | null; qty_received: number }[];
}): Completeness {
  const total = input.lines.length;
  if (total === 0) return input.simplifiedWithoutLines > 0 ? { kind: "unknown" } : { kind: "none" };
  const done = input.lines.filter((l) => orderLineStatus(l.qty_ordered, l.qty_received) === "received").length;
  if (input.simplifiedWithoutLines > 0 && done === total) return { kind: "unknown" };
  return { kind: done === total ? "complete" : "incomplete", done, total };
}

export type WorkState = "en_cours" | "travaux_termines" | "a_revalider";

/** Toute modification après « Travaux terminés » repasse le dossier à revalider. */
export function stateAfterChange(state: WorkState | null | undefined): WorkState {
  return state === "travaux_termines" || state === "a_revalider" ? "a_revalider" : "en_cours";
}

export function finishCheck(usages: { usage_status: string }[]): { pending: number; canFinishCleanly: boolean } {
  const pending = usages.filter((u) => u.usage_status === "pending").length;
  return { pending, canFinishCleanly: pending === 0 };
}

export function sessionMinutes(s: { started_at: string; stopped_at: string | null }, now = Date.now()): number {
  const end = s.stopped_at ? new Date(s.stopped_at).getTime() : now;
  return Math.max(0, Math.round((end - new Date(s.started_at).getTime()) / 60000));
}

export function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
}

export const USAGE_REASONS = [
  "Pièce non nécessaire",
  "Mauvaise référence",
  "Pièce endommagée",
  "Client a refusé",
  "Reportée à une autre intervention",
  "Autre",
] as const;
