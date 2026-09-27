/**
 * Pièces & achats — règles pures (testables) :
 * site actif global, détection de site sur un document, commandes en attente,
 * rapprochement document ↔ commande. Aucune écriture ici.
 */
import { normalizeRef } from "@/lib/parts-rules";

export type SiteLite = { id: string; code: string | null; name: string };

/**
 * Site d'écriture du module : le site actif global. En vue groupe (lecture seule),
 * on retombe sur le site du profil ; sinon aucun site → l'écran demande de choisir.
 */
export function partsWriteSite(active: string, isGroup: boolean, profileSite: string | null | undefined): string | null {
  if (!isGroup && active && active !== "groupe") return active;
  return profileSite ?? null;
}

/** Périmètre de lecture : site actif, ou tous les sites en vue groupe. */
export function partsReadSite(active: string, isGroup: boolean): string | null {
  return isGroup || !active || active === "groupe" ? null : active;
}

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const SITE_WORDS: Record<string, string[]> = {
  castillon: ["castillon", "st cyprien", "saint cyprien", "stcyprien", "veyssiere", "castels"],
  dda: ["lalinde", "digoin", "damien digoin", "dda"],
};

/** Site probable d'un document (texte lu : client livré, adresse…). null si incertain ou ambigu. */
export function guessDocumentSite(text: string | null | undefined, sites: SiteLite[]): string | null {
  const t = ` ${norm(text)} `;
  if (!t.trim()) return null;
  const hits = sites.filter((s) => {
    const words = [...(SITE_WORDS[s.code ?? ""] ?? []), norm(s.name)].filter((w) => w.length >= 3);
    return words.some((w) => t.includes(` ${w} `) || t.includes(` ${w}`));
  });
  return hits.length === 1 ? hits[0]!.id : null;
}

/** Alerte non bloquante si le document semble appartenir à un autre site que le site actif. */
export function siteMismatch(docSite: string | null, activeSite: string | null): boolean {
  return !!docSite && !!activeSite && docSite !== activeSite;
}

type OrderLike = {
  id: string;
  status: string;
  site_id: string;
  supplier_id: string | null;
  plate: string | null;
  supplier_order_ref: string | null;
  suppliers?: { name: string } | null;
  repair_orders?: { or_number: string | null } | null;
  part_order_lines?: { physical_reference: string | null; line_kind: string; status: string }[] | null;
};

/** Commandes en attente de réception : jamais les commandes totalement reçues ou annulées. */
export function pendingReceptionOrders<T extends { status: string }>(orders: T[]): T[] {
  return orders.filter((o) => o.status === "ordered" || o.status === "partial");
}

export type DocExtractLite = {
  supplier?: string | null;
  or_number?: string | null;
  plate?: string | null;
  order_reference?: string | null;
  lines?: { reference: string | null }[] | null;
};

const plateKey = (p: string | null | undefined) => (p ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/** Score de rapprochement document ↔ commande (0 = aucun indice). */
export function scoreOrderMatch(doc: DocExtractLite, order: OrderLike): number {
  let s = 0;
  const sup = norm(doc.supplier);
  const oname = norm(order.suppliers?.name);
  if (sup && oname && (sup.includes(oname) || oname.includes(sup))) s += 2;
  const orn = (doc.or_number ?? "").replace(/\D/g, "");
  const oorn = (order.repair_orders?.or_number ?? "").replace(/\D/g, "");
  if (orn && oorn && orn === oorn) s += 3;
  if (plateKey(doc.plate) && plateKey(doc.plate) === plateKey(order.plate)) s += 3;
  if (doc.order_reference && order.supplier_order_ref && normalizeRef(doc.order_reference) === normalizeRef(order.supplier_order_ref)) s += 4;
  const refs = new Set((order.part_order_lines ?? []).map((l) => normalizeRef(l.physical_reference ?? "")).filter(Boolean));
  let common = 0;
  for (const l of doc.lines ?? []) if (l.reference && refs.has(normalizeRef(l.reference))) common++;
  s += Math.min(common, 3);
  return s;
}

export type OrderMatch<T> = { order: T; score: number; level: "certain" | "probable" };

/** Commandes candidates, triées ; uniquement parmi les commandes en attente du site donné. */
export function matchOrders<T extends OrderLike>(doc: DocExtractLite, orders: T[], siteId: string | null): OrderMatch<T>[] {
  return pendingReceptionOrders(orders)
    .filter((o) => !siteId || o.site_id === siteId)
    .map((order) => ({ order, score: scoreOrderMatch(doc, order) }))
    .filter((m) => m.score >= 2)
    .sort((a, b) => b.score - a.score)
    .map((m) => ({ ...m, level: m.score >= 4 ? ("certain" as const) : ("probable" as const) }));
}

/** Fournisseur connu correspondant au nom lu (sinon null : l'utilisateur choisit). */
const GENERIC_WORDS = new Set(["groupe", "group", "auto", "autos", "automobile", "automobiles", "garage", "sas", "sarl", "distribution", "pieces", "piece", "france", "societe", "ets", "etablissements"]);
const sigWords = (s: string) => norm(s).split(" ").filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w));

export function matchSupplier<T extends { id: string; name: string; active?: boolean | null }>(name: string | null | undefined, suppliers: T[]): T | null {
  const n = norm(name);
  if (n.length < 3) return null;
  const pool = suppliers.filter((s) => s.active !== false && norm(s.name).length >= 3);
  const hits = pool.filter((s) => n.includes(norm(s.name)) || norm(s.name).includes(n));
  if (hits.length === 1) return hits[0]!;
  if (hits.length > 1) return null;
  // Mots significatifs communs, ordre indifférent (« X SARLAT - GROUPE FAURIE » ↔ « FAURIE AUTO SARLAT »).
  const words = new Set(sigWords(n));
  const scored = pool
    .map((s) => {
      const sw = sigWords(s.name);
      const shared = sw.filter((w) => words.has(w)).length;
      return { s, shared, ok: sw.length > 0 && (shared >= 2 || (shared === sw.length && shared >= 1)) };
    })
    .filter((x) => x.ok)
    .sort((a, b) => b.shared - a.shared);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[1]!.shared === scored[0]!.shared) return null;
  return scored[0]!.s;
}

/** Régularisations à ouvrir après validation d'une commande — jamais de blocage. */
export function orderGaps(o: { supplier_id: string | null; hasDocument: boolean; lines: number; repair_order_id: string | null; plate: string | null; destination: string; requested_or_number?: string | null }): string[] {
  const gaps: string[] = [];
  if (!o.supplier_id) gaps.push("commande_sans_fournisseur");
  if (o.destination === "or" && !o.repair_order_id && (o.requested_or_number ?? "").trim()) gaps.push("or_non_importe");
  else if (o.destination === "or" && !o.repair_order_id && !(o.plate ?? "").trim()) gaps.push("destination_inconnue");
  if (o.hasDocument && o.lines === 0) gaps.push("reference_a_completer");
  return gaps;
}
