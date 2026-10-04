// Miroir pur de sync_part_order_or (migration 0047) : rattachement commande -> OR + affectations « à pointer ».
export type LinkOrder = { id: string; site_id: string; status: string; destination: string; repair_order_id: string | null; requested_or_number: string | null };
export type LinkOr = { id: string; site_id: string; or_number: string };
export type LinkReceiptLine = { id: string; article_id: string | null; qty_received: number; qty_allocated?: number | null; condition?: string | null; receipt_cancelled?: boolean };
export type Usage = { receipt_line_id: string; qty_allocated: number; usage_status: "pending" };

export const normOr = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "").replace(/^0+/, "");

/** OR cible : lien existant conservé ; sinon OR unique du même site ; ambigu/absent/annulée => null. */
export function resolveOrLink(o: LinkOrder, ors: LinkOr[]): string | null {
  if (o.status === "cancelled" || o.destination !== "or") return null;
  if (o.repair_order_id) return o.repair_order_id;
  const key = normOr(o.requested_or_number);
  if (!key) return null;
  const hits = ors.filter((r) => r.site_id === o.site_id && normOr(r.or_number) === key);
  return hits.length === 1 ? hits[0]!.id : null;
}

/** Affectations à créer : une par ligne reçue utilisable, jamais si déjà affectée (receipt_line_id), stock suffisant. */
export function usagesToCreate(lines: LinkReceiptLine[], existing: { receipt_line_id: string }[], available: (articleId: string) => number): Usage[] {
  const done = new Set(existing.map((u) => u.receipt_line_id));
  const out: Usage[] = [];
  for (const l of lines) {
    if (l.receipt_cancelled || !l.article_id || done.has(l.id)) continue;
    if ((l.condition ?? "usable") !== "usable") continue;
    const q = l.qty_received - (l.qty_allocated ?? 0);
    if (q <= 0 || available(l.article_id) < q) continue;
    out.push({ receipt_line_id: l.id, qty_allocated: q, usage_status: "pending" });
  }
  return out;
}
