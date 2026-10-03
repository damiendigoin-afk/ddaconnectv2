/**
 * Logistique commande fournisseur (pur, testable) :
 *  - classement « Fournisseurs les plus utilisés » du site (fréquence pondérée par récence) ;
 *  - alerte RDV / livraison prévue (avertissement, jamais un blocage).
 */

/** Demi-vie de la pondération : une commande de 60 jours compte moitié moins qu'une commande du jour. */
export const SUPPLIER_HALF_LIFE_DAYS = 60;

export function rankSuppliers(
  orders: { supplier_id: string | null; created_at: string; status?: string | null }[],
  now: Date,
  max = 8,
): { supplierId: string; count: number; score: number }[] {
  const acc = new Map<string, { count: number; score: number }>();
  for (const o of orders) {
    if (!o.supplier_id || o.status === "cancelled") continue;
    const age = Math.max(0, (now.getTime() - new Date(o.created_at).getTime()) / 86_400_000);
    const w = Math.pow(0.5, age / SUPPLIER_HALF_LIFE_DAYS);
    const cur = acc.get(o.supplier_id) ?? { count: 0, score: 0 };
    acc.set(o.supplier_id, { count: cur.count + 1, score: cur.score + w });
  }
  return [...acc.entries()]
    .map(([supplierId, v]) => ({ supplierId, count: v.count, score: Math.round(v.score * 1000) / 1000 }))
    .sort((a, b) => b.score - a.score || b.count - a.count || a.supplierId.localeCompare(b.supplierId))
    .slice(0, max);
}

export type LogisticsAlert = { level: "warn" | "danger"; message: string };

const dayNum = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000);

/** today = date locale AAAA-MM-JJ. */
export function orderLogisticsAlert(
  o: { appointment_date?: string | null; expected_delivery_date?: string | null; status?: string | null },
  today: string,
): LogisticsAlert | null {
  if (!o.appointment_date || o.status === "received" || o.status === "cancelled") return null;
  const rdv = dayNum(o.appointment_date);
  const left = rdv - dayNum(today);
  if (left <= 1) {
    const when = left < 0 ? "RDV dépassé" : left === 0 ? "RDV aujourd'hui" : "RDV demain";
    const st = o.status === "partial" ? "partiellement reçue" : "non reçue";
    return { level: left <= 0 ? "danger" : "warn", message: `${when} — commande ${st}` };
  }
  return null;
}
