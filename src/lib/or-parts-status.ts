/**
 * Statut des pièces d'un OR : agrège commandes liées ET réceptions directes (sans commande DDA).
 * Une réception directe = réception validée, order_id null, rattachée à l'OR. Jamais de commande fictive.
 * Pur et testable ; réutilisable par toute vue OR.
 */
import { partsCompleteness, type Completeness } from "./parts-rules";

export type StatusOrderLine = { id: string; line_kind?: string | null; qty_ordered: number | null; qty_received: number };
export type StatusOrder = { id: string; status: string; part_order_lines?: StatusOrderLine[] | null };
export type StatusReceiptLine = {
  id: string;
  repair_order_id: string | null;
  qty_received: number;
  condition?: string | null;
  part_receipts: { id: string; order_id: string | null; status: string; repair_order_id: string | null; supplier_name?: string | null } | null;
};
export type StatusUsage = { usage_status: string; qty_allocated: number };

export type DirectSource = { supplier: string; receiptIds: string[]; qty: number };
export type OrPartsStatus = {
  kind: "none" | "orders" | "direct" | "mixed";
  completeness: Completeness;
  direct: { sources: DirectSource[]; total: number };
  usage: { atGarage: number; toPoint: number; used: number };
};

const isPartLine = (l: StatusOrderLine) => (l.line_kind ?? "part") === "part";

export function orPartsStatus(orId: string, orders: StatusOrder[], receiptLines: StatusReceiptLine[], usages: StatusUsage[]): OrPartsStatus {
  const live = orders.filter((o) => o.status !== "cancelled");
  const lines = live.flatMap((o) => (o.part_order_lines ?? []).filter(isPartLine));
  const simplified = live.filter((o) => !(o.part_order_lines ?? []).length).length;
  const completeness = partsCompleteness({ simplifiedWithoutLines: simplified, lines });

  // Réceptions liées à une commande sont déjà suivies via la commande : jamais comptées deux fois.
  const bySupplier = new Map<string, DirectSource>();
  for (const l of receiptLines) {
    const r = l.part_receipts;
    if (!r || r.order_id || r.status !== "validated") continue;
    if ((l.repair_order_id ?? r.repair_order_id) !== orId) continue;
    const name = r.supplier_name?.trim() || "Fournisseur ?";
    const s = bySupplier.get(name) ?? { supplier: name, receiptIds: [], qty: 0 };
    if (!s.receiptIds.includes(r.id)) s.receiptIds.push(r.id);
    s.qty += Number(l.qty_received) || 0;
    bySupplier.set(name, s);
  }
  const sources = [...bySupplier.values()].sort((a, b) => a.supplier.localeCompare(b.supplier));
  const total = sources.reduce((t, s) => t + s.qty, 0);

  const allocated = usages.filter((u) => Number(u.qty_allocated) > 0);
  const usage = {
    atGarage: allocated.length,
    toPoint: usages.filter((u) => u.usage_status === "pending").length,
    used: usages.filter((u) => u.usage_status === "used" || u.usage_status === "partial").length,
  };

  const hasOrders = live.length > 0;
  const hasDirect = sources.length > 0;
  const kind = hasOrders && hasDirect ? "mixed" : hasOrders ? "orders" : hasDirect || allocated.length ? "direct" : "none";
  return { kind, completeness, direct: { sources, total }, usage };
}
