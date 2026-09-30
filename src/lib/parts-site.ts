/**
 * Pièces & achats — règles pures (testables) :
 * site actif global, détection de site sur un document, commandes en attente,
 * rapprochement document ↔ commande. Aucune écriture ici.
 */
import { normalizeRef } from "@/lib/parts-rules";
import { supplierNames } from "@/lib/supplier-identify";

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
  /** Commandes simplifiées (front office) vs détaillées/importées. */
  order_mode?: string | null;
  comment?: string | null;
  created_by_name?: string | null;
  created_at?: string;
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
  /** Fiche fournisseur déjà identifiée sur le document. */
  supplier_id?: string | null;
  or_number?: string | null;
  plate?: string | null;
  order_reference?: string | null;
  /** Tous les identifiants lus (Transaction, Commande, BL, facture…) : aucun n'est supposé être LE n° commande. */
  ref_candidates?: string[] | null;
  document_number?: string | null;
  delivery_note_number?: string | null;
  invoice_number?: string | null;
  lines?: { reference: string | null; quantity?: number | null; label?: string | null; unit_price?: number | null }[] | null;
};

const plateKey = (p: string | null | undefined) => (p ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/** Identifiants candidats d'un document (dédoublonnés, normalisés). */
export function docIdentifiers(doc: DocExtractLite): string[] {
  const all = [doc.order_reference, doc.document_number, doc.delivery_note_number, doc.invoice_number, ...(doc.ref_candidates ?? [])];
  return [...new Set(all.map((v) => normalizeRef(v ?? "")).filter((v) => v.length >= 5))];
}

type LineLite = { physical_reference: string | null; line_kind: string; status: string; qty_ordered?: number | null; qty_received?: number | null; designation?: string | null; expected_unit_cost_ht?: number | null };

const LABEL_STOP = new Set(["avec", "pour", "sans", "gauche", "droit", "droite", "avant", "arriere", "piece", "pieces", "auto"]);
const labelWords = (s: string | null | undefined) => new Set(norm(s).split(" ").filter((w) => w.length >= 4 && !LABEL_STOP.has(w)));
/** Désignations proches : au moins 2 mots significatifs communs, et côté (gauche/droit) non contradictoire. */
export function similarDesignation(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = ` ${norm(a)} `, nb = ` ${norm(b)} `;
  const side = (t: string) => (/ (gauche|g|gche) /.test(t) ? "g" : / (droit|droite|d|dte) /.test(t) ? "d" : null);
  if (side(na) && side(nb) && side(na) !== side(nb)) return false;
  const wa = labelWords(a), wb = labelWords(b);
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared >= 2 || (shared >= 1 && Math.min(wa.size, wb.size) === 1);
}

/** Score explicable document ↔ commande : chaque indice ajoute des points et une raison lisible. */
export function explainOrderMatch(doc: DocExtractLite, order: OrderLike): { score: number; strong: number; idMatch: boolean; reasons: string[] } {
  let score = 0, strong = 0;
  let idMatch = false;
  const reasons: string[] = [];
  const sup = norm(doc.supplier);
  const oname = norm(order.suppliers?.name);
  if ((doc.supplier_id && doc.supplier_id === order.supplier_id) || (sup && oname && (sup.includes(oname) || oname.includes(sup)))) { score += 2; reasons.push("même fournisseur"); }
  const orn = (doc.or_number ?? "").replace(/\D/g, "");
  const oorn = (order.repair_orders?.or_number ?? "").replace(/\D/g, "");
  if (orn && oorn && orn === oorn) { score += 5; strong += 5; reasons.push(`OR ${oorn}`); }
  if (plateKey(doc.plate) && plateKey(doc.plate) === plateKey(order.plate)) { score += 4; strong += 4; idMatch = true; reasons.push(`immat ${doc.plate}`); }
  const oref = normalizeRef(order.supplier_order_ref ?? "");
  if (oref && docIdentifiers(doc).includes(oref)) { score += 6; strong += 6; idMatch = true; reasons.push(`n° commande ${order.supplier_order_ref}`); }
  const lines = (order.part_order_lines ?? []) as LineLite[];
  const byRef = new Map(lines.map((l) => [normalizeRef(l.physical_reference ?? ""), l] as const).filter(([k]) => k));
  let common = 0;
  for (const l of doc.lines ?? []) {
    const ol = l.reference ? byRef.get(normalizeRef(l.reference)) : undefined;
    if (!ol) continue;
    common++;
    if (common > 3) continue;
    // Référence exacte : indice fort. Quantité compatible (≤ reste à recevoir) : bonus.
    const rest = ol.qty_ordered != null ? Number(ol.qty_ordered) - Number(ol.qty_received ?? 0) : null;
    const qtyOk = l.quantity != null && rest != null && Number(l.quantity) > 0 && Number(l.quantity) <= rest;
    score += common === 1 ? 3 : 1;
    strong += common === 1 ? 3 : 1;
    if (qtyOk) score += 1;
    reasons.push(`réf ${l.reference}${qtyOk ? ` + qté ${l.quantity}` : ""}`);
  }
  // Sans référence commune : désignation proche (+ quantité / prix compatibles) = indice plus faible.
  if (!common) {
    for (const l of doc.lines ?? []) {
      const ol = lines.find((x) => x.line_kind !== "service" && similarDesignation(l.label, x.designation));
      if (!ol) continue;
      const rest = ol.qty_ordered != null ? Number(ol.qty_ordered) - Number(ol.qty_received ?? 0) : null;
      const qtyOk = l.quantity != null && rest != null && Number(l.quantity) > 0 && Number(l.quantity) <= rest;
      const pu = l.unit_price, exp = ol.expected_unit_cost_ht;
      const priceOk = pu != null && exp != null && Number(exp) > 0 && Math.abs(Number(pu) - Number(exp)) <= Math.max(0.5, Number(exp) * 0.05);
      score += 2 + (qtyOk ? 1 : 0) + (priceOk ? 1 : 0);
      strong += 1;
      reasons.push(`désignation proche « ${ol.designation} »${qtyOk ? ` + qté ${l.quantity}` : ""}${priceOk ? " + prix" : ""}`);
      break;
    }
  }
  return { score, strong, idMatch, reasons };
}

/** Score de rapprochement document ↔ commande (0 = aucun indice). */
export function scoreOrderMatch(doc: DocExtractLite, order: OrderLike): number {
  return explainOrderMatch(doc, order).score;
}

export type OrderMatch<T> = { order: T; score: number; level: "certain" | "probable"; reasons: string[] };

/** Commandes candidates, triées ; uniquement parmi les commandes en attente du site donné. */
export function matchOrders<T extends OrderLike>(doc: DocExtractLite, orders: T[], siteId: string | null): OrderMatch<T>[] {
  const recent = (a: T, b: T) => (b.created_at ?? "").localeCompare(a.created_at ?? "");
  return pendingReceptionOrders(orders)
    .filter((o) => !siteId || o.site_id === siteId)
    // Plaques différentes = autre véhicule : jamais candidate.
    .filter((o) => !(plateKey(doc.plate) && plateKey(o.plate) && plateKey(doc.plate) !== plateKey(o.plate)))
    .map((order) => ({ order, ...explainOrderMatch(doc, order) }))
    // Le fournisseur seul ne suffit jamais : il faut plaque, OR, n° commande ou référence commune.
    .filter((m) => m.strong > 0 && m.score >= 2)
    .sort((a, b) => b.score - a.score || recent(a.order, b.order))
    .map(({ order, score, idMatch, reasons }) => ({ order, score, reasons, level: idMatch && score >= 4 ? ("certain" as const) : ("probable" as const) }));
}

/**
 * Présentation UX du rapprochement : certaines (plaque / n° commande unique) à part,
 * au plus 3 correspondances probables classées avec raisons, jamais sur le fournisseur seul.
 * Deux « certaines » à égalité => ambiguïté : rétrogradées en probables (confirmation obligatoire).
 */
export function receptionSuggestions<T extends OrderLike>(doc: DocExtractLite, orders: T[], siteId: string | null, max = 3) {
  const all = matchOrders(doc, orders, siteId);
  let certain = all.filter((m) => m.level === "certain");
  if (certain.length > 1 && certain[0]!.score === certain[1]!.score) certain = [];
  const probable = all.filter((m) => !certain.includes(m)).slice(0, Math.max(0, max - Math.min(certain.length, max)));
  const ambiguous = !certain.length && probable.length > 1 && probable[0]!.score === probable[1]!.score;
  return { certain: certain.slice(0, max), probable, hasExact: certain.length > 0, ambiguous };
}

/**
 * Dernier niveau (confirmation obligatoire, jamais automatique) : commandes encore ouvertes du même
 * fournisseur, les plus récentes d'abord, quand aucun indice plus fort n'a été trouvé.
 */
export function supplierOpenOrders<T extends OrderLike>(doc: DocExtractLite, orders: T[], siteId: string | null, exclude: string[] = [], max = 3) {
  return pendingReceptionOrders(orders)
    .filter((o) => (!siteId || o.site_id === siteId) && !exclude.includes(o.id))
    .filter((o) => !(plateKey(doc.plate) && plateKey(o.plate) && plateKey(doc.plate) !== plateKey(o.plate)))
    .filter((o) => explainOrderMatch(doc, o).reasons.includes("même fournisseur"))
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
    .slice(0, max)
    .map((order) => ({ order, reasons: ["commande ouverte de ce fournisseur (aucun autre indice)"] }));
}

/**
 * Recherche manuelle : TOUTES les commandes en attente du site (détaillées/importées et simplifiées),
 * classées par pertinence vis-à-vis du document puis récence. Recherche texte : fournisseur, n° commande,
 * OR/dossier, immat, réf. pièce, désignation, commentaire, créateur.
 */
export function searchPendingOrders<T extends OrderLike & { requested_or_number?: string | null }>(orders: T[], query: string, siteId: string | null, max = 20, doc?: DocExtractLite): T[] {
  const q = norm(query);
  const qk = plateKey(query);
  const rel = (o: T) => (doc ? explainOrderMatch(doc, o) : null);
  const pending = pendingReceptionOrders(orders)
    .filter((o) => !siteId || o.site_id === siteId)
    .map((o) => ({ o, s: rel(o)?.strong ? rel(o)!.score : 0 }))
    .sort((a, b) => b.s - a.s || (b.o.created_at ?? "").localeCompare(a.o.created_at ?? ""))
    .map((x) => x.o);
  if (!q) return pending.slice(0, max);
  return pending.filter((o) => {
    const lines = (o.part_order_lines ?? []) as (LineLite & { designation?: string | null })[];
    const hay = [o.supplier_order_ref, o.repair_orders?.or_number, o.requested_or_number, o.suppliers?.name, o.comment, o.created_by_name, ...lines.map((l) => l.physical_reference), ...lines.map((l) => l.designation)].map((v) => norm(v ?? ""));
    if (hay.some((h) => h && h.includes(q))) return true;
    if (qk.length >= 3 && plateKey(o.plate).includes(qk)) return true;
    const rq = normalizeRef(query);
    return !!rq && lines.some((l) => normalizeRef(l.physical_reference ?? "").includes(rq));
  }).slice(0, max);
}

/**
 * Ligne d'identification d'une commande simplifiée : commentaire + créateur + date/heure.
 * Pour ces commandes saisies au comptoir, le commentaire est le principal repère humain ;
 * sans commentaire ni créateur on retombe sur « Contenu non détaillé ».
 */
export type SimplifiedOrderMeta = { comment: string | null; createdBy: string | null; when: string | null; hasMeta: boolean };

export function simplifiedOrderMeta(o: { order_mode?: string | null; comment?: string | null; created_by_name?: string | null; created_at?: string | null }): SimplifiedOrderMeta {
  if (o.order_mode !== "simplified") return { comment: null, createdBy: null, when: null, hasMeta: false };
  const comment = o.comment?.trim() ? o.comment.trim() : null;
  const createdBy = o.created_by_name?.trim() ? o.created_by_name.trim() : null;
  let when: string | null = null;
  if (o.created_at) {
    const d = new Date(o.created_at);
    when = isNaN(d.getTime()) ? null : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  }
  return { comment, createdBy, when, hasMeta: !!(comment || createdBy) };
}

/** Fournisseur connu correspondant au nom lu (sinon null : l'utilisateur choisit). */
const GENERIC_WORDS = new Set(["groupe", "group", "auto", "autos", "automobile", "automobiles", "garage", "sas", "sarl", "distribution", "pieces", "piece", "france", "societe", "ets", "etablissements"]);
const sigWords = (s: string) => norm(s).split(" ").filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w));

export function matchSupplier<T extends { id: string; name: string; active?: boolean | null; notes?: string | null }>(name: string | null | undefined, suppliers: T[]): T | null {
  const n = norm(name);
  if (n.length < 3) return null;
  const pool = suppliers.filter((s) => s.active !== false && norm(s.name).length >= 3);
  // Nom ou enseigne/alias déclaré sur la fiche.
  const nc = n.replace(/ /g, "");
  const hits = pool.filter((s) => supplierNames(s).map(norm).some((sn) => sn.length >= 3 && (n.includes(sn) || sn.includes(n) || nc.includes(sn.replace(/ /g, "")))));
  if (hits.length === 1) return hits[0]!;
  if (hits.length > 1) return null;
  // Mots significatifs communs, ordre indifférent (« X SARLAT - GROUPE FAURIE » ↔ « FAURIE AUTO SARLAT »).
  const words = new Set(sigWords(n));
  const scored = pool
    .map((s) => {
      const sw = sigWords(s.name);
      const shared = sw.filter((w) => words.has(w)).length;
      // Mots distinctifs de part et d'autre (ex. SARLAT ≠ BERGERAC sur un groupe commun) : jamais la même fiche.
      const conflict = sw.some((w) => !words.has(w)) && [...words].some((w) => !sw.includes(w));
      return { s, shared, ok: sw.length > 0 && !conflict && (shared >= 2 || (shared === sw.length && shared >= 1)) };
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
  // N° de dossier lu (requested_or_number) ou plaque = commande suffisamment rattachée ; la facture WinMotor confirmera.
  if (o.destination === "or" && !o.repair_order_id && !(o.requested_or_number ?? "").trim() && !(o.plate ?? "").trim()) gaps.push("destination_inconnue");
  if (o.hasDocument && o.lines === 0) gaps.push("reference_a_completer");
  return gaps;
}

/** N° de dossier / OR WinMotor conservé quand aucun OR DDA réel n'est rattaché (jamais d'OR fictif). */
export function requestedDossier(realOr: { id: string } | null | undefined, typed: string | null | undefined): string | null {
  if (realOr) return null;
  const v = (typed ?? "").trim();
  return v || null;
}

/**
 * Commande fournisseur multi-OR : regroupe les lignes par repère OR affecté (une commande DDA par OR,
 * même n° de commande fournisseur). Une ligne non affectée va au premier OR ; un OR sans ligne est omis.
 */
export function groupLinesByOr<L extends { or?: string | null }>(ors: string[], lines: L[]): { or: string; lines: L[] }[] {
  if (!ors.length) return [];
  return ors
    .map((or, i) => ({ or, lines: lines.filter((l) => (l.or && ors.includes(l.or) ? l.or === or : i === 0)) }))
    .filter((g) => g.lines.length);
}
