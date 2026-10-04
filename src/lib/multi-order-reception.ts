/**
 * BL couvrant plusieurs commandes — règles pures (testables), aucune écriture ici.
 * Ordre : fournisseur identique (bloquant) → pour chaque ligne du BL, référence physique exacte
 * parmi les lignes restant à recevoir des commandes ouvertes du même fournisseur et du même site
 * → quantité contrôlée contre le reliquat (confirme/répartit) → regroupement par commande.
 * Jamais de désignation, jamais de prix comme critère ; une référence présente sur plusieurs
 * commandes compatibles reste ambiguë (choix utilisateur ligne par ligne).
 */
import { normalizeRef } from "@/lib/parts-rules";
import { pendingReceptionOrders, sameSupplier, type DocExtractLite } from "@/lib/parts-site";

export const PRICE_GAP_LABEL = "Écart de prix à contrôler — une remise de fin de mois peut l'expliquer.";

export type MoLine = { id: string; line_kind: string; status: string; physical_reference: string | null; designation?: string | null; qty_ordered: number | null; qty_received: number | null; expected_unit_cost_ht?: number | null; requested_or_number?: string | null; repair_order_id?: string | null };
export type MoOrder = {
  id: string; status: string; site_id: string; supplier_id: string | null; plate: string | null; supplier_order_ref: string | null;
  requested_or_number?: string | null; repair_order_id?: string | null; created_at?: string; destination?: string | null;
  suppliers?: { name: string } | null; repair_orders?: { or_number: string | null } | null; part_order_lines?: MoLine[] | null;
};
export type MoDocLine = { reference: string | null; quantity?: number | null; label?: string | null; unit_price?: number | null; amount?: number | null };
export type MoDoc = Pick<DocExtractLite, "supplier" | "supplier_id"> & { lines?: MoDocLine[] | null };

export type LineCandidate = { orderId: string; orderLineId: string; remaining: number };
export type LineAssign = {
  index: number; line: MoDocLine;
  state: "matched" | "ambiguous" | "unmatched";
  /** Commande retenue (matched) — ou null. */
  orderId: string | null; orderLineId: string | null;
  candidates: LineCandidate[];
  qtyOverRemaining: boolean;
  priceGap: number | null;
  reason: string;
};

const remainingOf = (l: MoLine) => Math.max(0, Number(l.qty_ordered ?? 0) - Number(l.qty_received ?? 0));
const openPartLine = (l: MoLine) => l.line_kind === "part" && l.status !== "cancelled" && l.status !== "received" && remainingOf(l) > 0;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Repère fiable porté par la commande DDA : requested_or_number, sinon OR DDA, sinon repère de ligne. */
export function orderRepere(o: MoOrder): string | null {
  const v = o.requested_or_number?.trim() || o.repair_orders?.or_number?.trim() || (o.part_order_lines ?? []).map((l) => l.requested_or_number?.trim()).find(Boolean) || null;
  return v || null;
}

/** Montant HT de ligne du BL (montant lu, sinon PU × qté). */
const docLineTotal = (l: MoDocLine) => (l.amount != null ? Number(l.amount) : l.unit_price != null ? Number(l.unit_price) * Number(l.quantity ?? 1) : null);

function gap(l: MoDocLine, ol: MoLine | undefined): number | null {
  const t = docLineTotal(l);
  if (!ol || t == null || ol.expected_unit_cost_ht == null) return null;
  const d = r2(t - Number(ol.expected_unit_cost_ht) * Number(l.quantity ?? 1));
  return d === 0 ? null : d;
}

/**
 * Répartition automatique des lignes du BL. `choices` : choix utilisateur par index de ligne
 * (id de commande ou "none" = acceptée sans commande) — prioritaire sur l'automatique.
 */
export function dispatchDocLines(doc: MoDoc, orders: MoOrder[], siteId: string | null, choices: Record<number, string | "none"> = {}) {
  const supplierKnown = !!(doc.supplier_id || doc.supplier);
  const pool = supplierKnown
    ? pendingReceptionOrders(orders).filter((o) => (!siteId || o.site_id === siteId) && sameSupplier(doc, o as never))
    : [];
  const left = new Map<string, number>();
  for (const o of pool) for (const l of o.part_order_lines ?? []) if (openPartLine(l)) left.set(l.id, remainingOf(l));
  const lineById = new Map<string, MoLine>();
  for (const o of pool) for (const l of o.part_order_lines ?? []) lineById.set(l.id, l);

  const candidatesFor = (ref: string) => {
    const out: LineCandidate[] = [];
    for (const o of pool) {
      const l = (o.part_order_lines ?? []).find((x) => openPartLine(x) && normalizeRef(x.physical_reference ?? "") === ref && (left.get(x.id) ?? 0) > 0);
      if (l) out.push({ orderId: o.id, orderLineId: l.id, remaining: left.get(l.id) ?? 0 });
    }
    return out;
  };

  const assigns: LineAssign[] = (doc.lines ?? []).map((line, index) => {
    const ref = normalizeRef(line.reference ?? "");
    const qty = Number(line.quantity ?? 1) || 1;
    const base = { index, line, orderId: null, orderLineId: null, candidates: [] as LineCandidate[], qtyOverRemaining: false, priceGap: null };
    if (!supplierKnown) return { ...base, state: "unmatched" as const, reason: "fournisseur à confirmer" };
    const choice = choices[index];
    if (choice === "none") return { ...base, state: "unmatched" as const, reason: "acceptée sans commande" };
    if (!ref) return { ...base, state: "unmatched" as const, reason: "référence non lue" };
    const cands = candidatesFor(ref);
    let pick: LineCandidate | undefined;
    if (choice) pick = cands.find((c) => c.orderId === choice);
    else if (cands.length === 1) pick = cands[0];
    else if (cands.length > 1) {
      // La quantité départage seulement : une seule commande dont le reliquat couvre la quantité.
      const fit = cands.filter((c) => c.remaining >= qty);
      if (fit.length === 1) pick = fit[0];
    }
    if (!cands.length) return { ...base, state: "unmatched" as const, reason: "aucune commande ouverte de ce fournisseur avec cette référence" };
    if (!pick) return { ...base, candidates: cands, state: "ambiguous" as const, reason: `référence présente sur ${cands.length} commandes` };
    left.set(pick.orderLineId, (left.get(pick.orderLineId) ?? 0) - qty);
    return {
      ...base, candidates: cands, state: "matched" as const, orderId: pick.orderId, orderLineId: pick.orderLineId,
      qtyOverRemaining: qty > pick.remaining, priceGap: gap(line, lineById.get(pick.orderLineId)),
      reason: `réf ${line.reference} exacte${qty <= pick.remaining ? ` + qté ${qty} ≤ reliquat ${pick.remaining}` : ` (qté ${qty} > reliquat ${pick.remaining})`}`,
    };
  });

  const byOrder = new Map<string, LineAssign[]>();
  for (const a of assigns) if (a.state === "matched" && a.orderId) byOrder.set(a.orderId, [...(byOrder.get(a.orderId) ?? []), a]);
  const groups = pool
    .filter((o) => byOrder.has(o.id))
    .map((order) => ({ order, repere: orderRepere(order), lines: byOrder.get(order.id)! }));
  const matchedTotals = assigns.filter((a) => a.state === "matched").reduce(
    (s, a) => {
      const t = docLineTotal(a.line);
      const ol = lineById.get(a.orderLineId!);
      return { doc: s.doc + (t ?? 0), expected: s.expected + (ol?.expected_unit_cost_ht != null ? Number(ol.expected_unit_cost_ht) * Number(a.line.quantity ?? 1) : t ?? 0) };
    },
    { doc: 0, expected: 0 },
  );
  const globalGap = r2(matchedTotals.doc - matchedTotals.expected);
  return {
    supplierKnown,
    groups,
    ambiguous: assigns.filter((a) => a.state === "ambiguous"),
    unmatched: assigns.filter((a) => a.state === "unmatched"),
    assigns,
    globalGap: globalGap === 0 ? null : globalGap,
    /** Document entièrement traité : chaque ligne affectée à une commande ou explicitement acceptée sans commande. */
    complete: assigns.every((a) => a.state === "matched" || (a.state === "unmatched" && choices[a.index] === "none")),
  };
}

export type MultiDispatch = ReturnType<typeof dispatchDocLines>;

/** Payload de réception d'une commande (même document source, même n° de BL). */
export type MultiReceiptPayload = {
  order_id: string | null; repair_order_id: string | null; plate: string | null; requested_or_number: string | null; supplier_order_ref: string | null;
  lines: { order_line_id: string | null; physical_reference: string; designation: string; qty_expected: number | null; qty_received: number; unit_cost: number | null; expected_cost: number | null; ordered_reference: string | null; destination: "or" | "store_sale" | "stock" | "unknown" }[];
};

/** Même règle que la réception depuis une commande : OR sans dossier DDA réel => destination à préciser. */
function lineDestination(o: MoOrder, l: MoLine): "or" | "store_sale" | "stock" | "unknown" {
  const d = o.destination ?? "or";
  if (d === "stock" || d === "store_sale") return d;
  return l.repair_order_id || o.repair_order_id ? "or" : "unknown";
}

/** Une réception par commande retrouvée + (option) une réception sans commande pour les lignes acceptées explicitement. */
export function multiReceiptPayloads(plan: MultiDispatch, choices: Record<number, string | "none">): MultiReceiptPayload[] {
  const unit = (l: MoDocLine) => (l.unit_price != null ? Number(l.unit_price) : l.amount != null ? r2(Number(l.amount) / (Number(l.quantity ?? 1) || 1)) : null);
  const out: MultiReceiptPayload[] = plan.groups.map(({ order, repere, lines }) => ({
    order_id: order.id,
    repair_order_id: order.repair_order_id ?? null,
    plate: order.plate,
    requested_or_number: order.repair_order_id ? null : repere,
    supplier_order_ref: order.supplier_order_ref,
    lines: lines.map((a) => {
      const ol = (order.part_order_lines ?? []).find((l) => l.id === a.orderLineId)!;
      return {
        order_line_id: ol.id, physical_reference: (a.line.reference ?? ol.physical_reference ?? "").trim(), designation: (a.line.label ?? ol.designation ?? "").trim(),
        qty_expected: remainingOf(ol), qty_received: Number(a.line.quantity ?? 1) || 1, unit_cost: unit(a.line), expected_cost: ol.expected_unit_cost_ht ?? null, ordered_reference: ol.physical_reference,
        destination: lineDestination(order, ol),
      };
    }),
  }));
  const accepted = plan.unmatched.filter((a) => choices[a.index] === "none");
  if (accepted.length) {
    out.push({
      order_id: null, repair_order_id: null, plate: null, requested_or_number: null, supplier_order_ref: null,
      lines: accepted.map((a) => ({ order_line_id: null, physical_reference: (a.line.reference ?? "").trim(), designation: (a.line.label ?? "").trim(), qty_expected: null, qty_received: Number(a.line.quantity ?? 1) || 1, unit_cost: unit(a.line), expected_cost: null, ordered_reference: null, destination: "unknown" as const })),
    });
  }
  return out;
}

/**
 * Idempotence : une réception (non annulée) déjà créée depuis ce document pour cette commande
 * (ou sans commande) n'est jamais recréée — second clic, rechargement, reprise après erreur.
 */
export function payloadsToCreate(payloads: MultiReceiptPayload[], existing: { order_id: string | null; status: string }[]): MultiReceiptPayload[] {
  const done = new Set(existing.filter((e) => e.status !== "cancelled").map((e) => e.order_id ?? "none"));
  return payloads.filter((p) => !done.has(p.order_id ?? "none"));
}

/** Expédition par commande déduite du BL multi-commandes : quantité du document = expédiée, jamais reçue. */
export function multiShipmentPayloads(plan: MultiDispatch): { order_id: string; lines: { order_line_id: string; qty: number }[] }[] {
  return plan.groups
    .map(({ order, lines }) => ({ order_id: order.id, lines: lines.filter((a) => a.orderLineId).map((a) => ({ order_line_id: a.orderLineId as string, qty: Number(a.line.quantity ?? 1) || 1 })) }))
    .filter((p) => p.lines.length);
}
