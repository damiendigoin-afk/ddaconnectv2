/**
 * Expédition fournisseur ≠ réception physique (règles pures, testables).
 * Un BL / facture / avis d'expédition prouve que la pièce est EXPÉDIÉE : il alimente qty_shipped,
 * jamais qty_received, jamais le stock. Seule la confirmation physique au garage crée une réception.
 */
import { normalizeRef } from "@/lib/parts-rules";

export type ShipLine = {
  id?: string;
  line_kind?: string;
  physical_reference?: string | null;
  designation?: string | null;
  qty_ordered?: number | null;
  qty_received?: number | null;
  qty_shipped?: number | null;
  expected_unit_cost_ht?: number | null;
  status?: string;
};

export type ShipDocLine = { reference?: string | null; label?: string | null; quantity?: number | null };

export type LineShipDisplay = "ordered" | "shipped" | "partial" | "received" | "cancelled";

export const SHIP_STATUS_LABEL: Record<LineShipDisplay, string> = {
  ordered: "Commandée",
  shipped: "Expédiée",
  partial: "Reçue partiellement",
  received: "Reçue",
  cancelled: "Annulée",
};

export const SHIPMENT_BANNER = "Expédition fournisseur détectée — réception physique non confirmée";

export function shipMetrics(l: ShipLine) {
  const ordered = l.qty_ordered == null ? null : Number(l.qty_ordered);
  const shipped = Number(l.qty_shipped ?? 0);
  const received = Number(l.qty_received ?? 0);
  return { ordered, shipped, received, toReceive: Math.max(0, shipped - received) };
}

/** Statut affiché : « Expédiée » quand le fournisseur a expédié plus que ce qui est physiquement reçu. */
export function lineShipDisplay(l: ShipLine): LineShipDisplay {
  if (l.status === "cancelled") return "cancelled";
  const m = shipMetrics(l);
  if (m.ordered != null && m.received >= m.ordered && m.received > 0) return "received";
  if (m.toReceive > 0) return "shipped";
  if (m.received > 0) return m.ordered == null ? "received" : "partial";
  return "ordered";
}

/** Lignes de pièces expédiées mais pas encore reçues physiquement. */
export function shippedToReceive<T extends ShipLine>(lines: T[]): T[] {
  return lines.filter((l) => (l.line_kind ?? "part") === "part" && l.status !== "cancelled" && shipMetrics(l).toReceive > 0);
}

export function hasPendingShipment(o: { status: string; part_order_lines?: ShipLine[] | null }): boolean {
  return o.status !== "cancelled" && o.status !== "received" && shippedToReceive(o.part_order_lines ?? []).length > 0;
}

/**
 * Quantité expédiée par le document pour chaque ligne de commande.
 * Référence exacte (normalisée) d'abord ; commande à une seule ligne + document à une seule ligne => cette ligne ;
 * sans ligne lisible sur le document => reliquat non encore expédié. Jamais au-delà du commandé non expédié si inconnu.
 */
export function shipmentQtyFromDoc(orderLines: ShipLine[], docLines: ShipDocLine[] | null | undefined): { order_line_id: string; qty: number }[] {
  const parts = orderLines.filter((l) => (l.line_kind ?? "part") === "part" && l.status !== "cancelled" && l.status !== "received" && l.id);
  const docs = (docLines ?? []).filter((d) => d.reference || d.label);
  const notShipped = (l: ShipLine) => {
    const m = shipMetrics(l);
    return m.ordered == null ? 1 : Math.max(0, m.ordered - Math.max(m.shipped, m.received));
  };
  const out: { order_line_id: string; qty: number }[] = [];
  if (!docs.length) {
    for (const l of parts) { const q = notShipped(l); if (q > 0) out.push({ order_line_id: l.id!, qty: q }); }
    return out;
  }
  const used = new Set<number>();
  for (const l of parts) {
    const ref = normalizeRef(l.physical_reference ?? "");
    const idx = ref ? docs.findIndex((d, i) => !used.has(i) && normalizeRef(d.reference ?? "") === ref) : -1;
    if (idx >= 0) {
      used.add(idx);
      const q = Number(docs[idx]!.quantity ?? 0) || notShipped(l);
      if (q > 0) out.push({ order_line_id: l.id!, qty: q });
    }
  }
  if (!out.length && parts.length === 1 && docs.length === 1) {
    const q = Number(docs[0]!.quantity ?? 0) || notShipped(parts[0]!);
    if (q > 0) out.push({ order_line_id: parts[0]!.id!, qty: q });
  }
  return out;
}

/** Statut affiché d'une commande dans le suivi atelier de l'OR (réception > expédition > commandée). */
export function orderTrackLabel(o: { status?: string | null; part_order_lines?: ShipLine[] | null }): string {
  if (o.status === "cancelled") return "Annulée";
  if (o.status === "received") return "Reçue";
  const lines = (o.part_order_lines ?? []).filter((l) => (l.line_kind ?? "part") === "part" && l.status !== "cancelled");
  const m = lines.map(shipMetrics);
  const ordered = m.reduce((t, x) => t + (x.ordered ?? 0), 0);
  const received = m.reduce((t, x) => t + x.received, 0);
  const shipped = m.reduce((t, x) => t + x.shipped, 0);
  if (lines.length && ordered > 0 && received >= ordered) return "Reçue";
  if (o.status === "partial" || received > 0) return shipped > received ? "Partiellement reçue — reliquat expédié" : "Partiellement reçue — reliquat";
  if (shipped > 0) return ordered > 0 && shipped < ordered ? "Partiellement expédiée" : "Expédiée";
  return "Commandée";
}

/** Fournisseurs présents dans les commandes à réceptionner, avec compteur (tri par nom). */
export function supplierFilterOptions(orders: { supplier_id?: string | null; suppliers?: { name: string } | null }[]): { id: string; name: string; count: number }[] {
  const map = new Map<string, { id: string; name: string; count: number }>();
  for (const o of orders) {
    const id = o.supplier_id ?? "none";
    const cur = map.get(id) ?? { id, name: o.suppliers?.name ?? "Fournisseur à préciser", count: 0 };
    cur.count++;
    map.set(id, cur);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

export function filterBySupplier<T extends { supplier_id?: string | null }>(orders: T[], supplierId: string): T[] {
  if (!supplierId) return orders;
  return orders.filter((o) => (o.supplier_id ?? "none") === supplierId);
}
