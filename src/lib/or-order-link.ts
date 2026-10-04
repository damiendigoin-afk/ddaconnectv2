/**
 * Rattachement commande fournisseur ↔ OR WinMotor (miroir pur des triggers SQL 0042).
 * Clé : site + n° OR WinMotor normalisé (repère OR de la commande) ; la plaque ne sert
 * qu'à refuser un rapprochement contradictoire. Jamais d'OR créé, jamais entre sites.
 */
export const normOrNumber = (v: unknown): string | null =>
  String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "") || null;
export const normPlateKey = (v: unknown): string | null => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") || null;

export type LinkOrder = { site_id: string; repair_order_id: string | null; requested_or_number: string | null; plate: string | null; destination: string; status: string };
export type LinkOr = { id: string; site_id: string; or_number: string | null; plate: string | null; status?: string | null };

/** OR unique et non contradictoire pour la commande, sinon null (absent, ambigu, autre site, plaque différente). */
export function resolveOrForOrder(o: LinkOrder, ors: LinkOr[]): string | null {
  if (o.repair_order_id) return o.repair_order_id;
  if (o.destination !== "or" || o.status === "cancelled") return null;
  const key = normOrNumber(o.requested_or_number);
  if (!key) return null;
  const hits = ors.filter((r) => r.site_id === o.site_id && normOrNumber(r.or_number) === key && r.status !== "cancelled");
  if (hits.length !== 1) return null;
  const a = normPlateKey(o.plate), b = normPlateKey(hits[0]!.plate);
  if (a && b && a !== b) return null;
  return hits[0]!.id;
}
