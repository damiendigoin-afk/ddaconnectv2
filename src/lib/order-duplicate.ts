/**
 * Commande fournisseur similaire déjà passée — AVERTISSEMENT seulement.
 * Principe : anti-doublon commande = avertissement + confirmation utilisateur ;
 * jamais unicité métier bloquante (recommander le même pneu est légitime).
 *
 * Similaire = même site + même fournisseur + même destination + même cible
 * (OR DDA > n° de dossier > plaque normalisée > neutre) + au moins une ligne
 * de même référence normalisée (désignation en repli) et même PA HT au centime.
 * Quantité indifférente. Commandes annulées ignorées.
 */
export type OrderLineLike = {
  physical_reference: string | null;
  designation: string | null;
  expected_unit_cost_ht: number | null;
  qty_ordered?: number | null;
};

export type OrderKey = {
  site_id: string;
  destination: string | null;
  supplier_id: string | null;
  supplier_order_ref: string | null;
  source_document_id: string | null;
  repair_order_id: string | null;
  requested_or_number: string | null;
  plate: string | null;
  /** N° de l'OR WinMotor rattaché (candidat), si connu. */
  or_number?: string | null;
};

export type PastOrder = OrderKey & {
  id: string;
  status: string;
  created_at: string | null;
  part_order_lines: OrderLineLike[] | null;
  suppliers?: { name: string } | null;
  repair_orders?: { or_number: string | null } | null;
};

export type SimilarOrder = {
  order: PastOrder;
  lines: OrderLineLike[];
  sameDocument: boolean;
  sameSupplierRef: boolean;
};

export function orderTarget(o: Pick<OrderKey, "repair_order_id" | "requested_or_number" | "plate">): string {
  if (o.repair_order_id) return `ro:${o.repair_order_id}`;
  const or = (o.requested_or_number ?? "").trim().toUpperCase();
  if (or) return `or:${or}`;
  const plate = (o.plate ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (plate) return `plate:${plate}`;
  return "none";
}

const normOr = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();
const normPlate = (v: string | null | undefined) => (v ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/**
 * Même cible dossier/OR, tolérante : un OR DDA peut être rattaché d'un côté et seulement
 * le n° de dossier saisi de l'autre (même n°), ou seule la plaque connue d'un côté.
 * Deux OR / dossiers différents ne sont jamais la même cible, même plaque.
 */
export function sameTarget(a: OrderKey & { repair_orders?: { or_number: string | null } | null }, b: OrderKey & { repair_orders?: { or_number: string | null } | null }): boolean {
  if (a.repair_order_id && b.repair_order_id && a.repair_order_id === b.repair_order_id) return true;
  const ors = (o: typeof a) => new Set([normOr(o.requested_or_number), normOr(o.or_number), normOr(o.repair_orders?.or_number)].filter(Boolean));
  const oa = ors(a), ob = ors(b);
  const hasA = oa.size > 0 || Boolean(a.repair_order_id), hasB = ob.size > 0 || Boolean(b.repair_order_id);
  if ([...oa].some((x) => ob.has(x))) return true;
  if (hasA && hasB) return false;
  const pa = normPlate(a.plate), pb = normPlate(b.plate);
  if (pa && pb) return pa === pb;
  return !hasA && !hasB && !pa && !pb;
}

const norm = (v: string | null | undefined) => (v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/** Clé article : référence normalisée, sinon désignation normalisée ; null si vide. */
export function lineArticleKey(l: OrderLineLike): string | null {
  const r = norm(l.physical_reference);
  if (r) return `R:${r}`;
  const d = norm(l.designation);
  return d ? `D:${d}` : null;
}

const cents = (v: number | null | undefined) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100));

export function sameOrderLine(a: OrderLineLike, b: OrderLineLike): boolean {
  const k = lineArticleKey(a);
  return Boolean(k) && k === lineArticleKey(b) && cents(a.expected_unit_cost_ht) === cents(b.expected_unit_cost_ht);
}

/** Commande précédente la plus récente ayant au moins une ligne identique, sinon null. */
export function findSimilarIn(candidate: OrderKey & { lines: OrderLineLike[] }, past: PastOrder[]): SimilarOrder | null {
  if (!candidate.supplier_id) return null;
  const hits: SimilarOrder[] = [];
  for (const o of past) {
    if (o.status === "cancelled" || o.site_id !== candidate.site_id || o.supplier_id !== candidate.supplier_id) continue;
    if ((o.destination ?? null) !== (candidate.destination ?? null) || !sameTarget(candidate, o)) continue;
    const lines = (o.part_order_lines ?? []).filter((pl) => candidate.lines.some((cl) => sameOrderLine(cl, pl)));
    if (!lines.length) continue;
    const ref = (candidate.supplier_order_ref ?? "").trim();
    hits.push({
      order: o,
      lines,
      sameDocument: Boolean(candidate.source_document_id && o.source_document_id === candidate.source_document_id),
      sameSupplierRef: Boolean(ref && (o.supplier_order_ref ?? "").trim() === ref),
    });
  }
  hits.sort((a, b) => String(b.order.created_at ?? "").localeCompare(String(a.order.created_at ?? "")));
  return hits[0] ?? null;
}

/** « 03/10/2026 à 20:00 » (heure locale). */
export function orderDateTime(iso: string | null | undefined): string {
  if (!iso) return "date inconnue";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} à ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function similarConfirmText(s: SimilarOrder): string {
  const head = s.sameDocument || s.sameSupplierRef ? "Même bon de commande déjà importé" : "Une commande similaire existe déjà";
  return `${head}, passée le ${orderDateTime(s.order.created_at)}. Voulez-vous vraiment créer une nouvelle commande ?`;
}
