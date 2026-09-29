/**
 * Post-traitement générique d'un document d'achat lu par OCR (commande, BL, facture).
 * Aucune règle propre à un fournisseur : alias de libellés courants + cohérence des prix avec le total HT.
 */
import { findFrenchPlate } from "@/lib/plate";
import type { InvoiceExtract, InvoiceLine, SupplierInfo } from "@/lib/supplier-docs";

type Raw = Record<string, unknown> & Partial<Record<"doc_kind"|"document_number"|"document_date"|"delivery_note_number"|"invoice_number"|"invoice_date"|"plate"|"plate_printed"|"customer_or_site"|"total_ht"|"vat_amount"|"total_ttc"|"handwritten_notes"|"lines"|"quantity"|"qty"|"qte"|"qty_ordered"|"amount"|"net_amount"|"line_total_ht"|"montant_net"|"net_unit_price"|"unit_net_price"|"client_price"|"public_price"|"list_price"|"unit_price"|"price"|"expected_unit_cost_ht"|"discount_pct", unknown>>;

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s && s.toLowerCase() !== "null" ? s : null;
};

export const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = str(v);
  if (!s) return null;
  const n = Number(s.replace(/[€\s\u00a0]/g, "").replace(/HT|TTC/gi, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const pick = (o: Raw, keys: string[]) => {
  for (const k of keys) {
    const v = str(o[k]);
    if (v) return v;
  }
  return null;
};

const digits = (v: string | null) => {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length >= 3 ? d : null;
};

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 0.005);

/**
 * PA unitaire attendu : le montant net de ligne (÷ quantité) prime sur un « prix client / public ».
 * Si la somme des montants nets est cohérente avec le total HT, elle fait foi.
 */
type NormLine = InvoiceLine & { client_price?: number | null; isolated_number?: string | null };

/**
 * Dossier atelier imprimé seul sous la désignation (BL Renault/Faurie…) : retenu seulement
 * si exactement 5 chiffres, une valeur unique sur tout le document, et distinct des
 * n° de document/BL/commande/facture et des références article.
 */
export function isolatedOrNumber(lines: NormLine[], exclude: (string | null | undefined)[]): string | null {
  const vals = new Set<string>();
  for (const l of lines) {
    const raw = (l.isolated_number ?? "").trim();
    if (!raw) continue;
    if (!/^\d{5}$/.test(raw.replace(/\s/g, ""))) return null;
    vals.add(raw.replace(/\s/g, ""));
  }
  if (vals.size !== 1) return null;
  const v = [...vals][0]!;
  const blocked = [...exclude, ...lines.map((l) => l.reference)].map((x) => (x ?? "").replace(/\D/g, ""));
  if (blocked.some((b) => b && (b === v || b.includes(v)))) return null;
  return v;
}

function normLine(l: Raw): NormLine {
  // Le pipeline peut déjà avoir converti une ligne au contrat du formulaire.
  // Accepter les deux contrats rend la normalisation idempotente et empêche une
  // seconde normalisation navigateur de remplacer trois lignes par trois lignes vides.
  const quantity = num(l.quantity ?? l.qty ?? l.qte ?? l["quantite"] ?? l.qty_ordered) ?? null;
  const amount = num(l.amount ?? l.net_amount ?? l.line_total_ht ?? l.montant_net ?? l.total_ht);
  const unitNet = num(l.net_unit_price ?? l.unit_net_price);
  const clientPrice = num(l.client_price ?? l.public_price ?? l.list_price);
  let unit = num(l.unit_price ?? l.price ?? l["prix_unitaire"] ?? l["pu"] ?? l.expected_unit_cost_ht);
  const q = quantity && quantity > 0 ? quantity : 1;
  if (unitNet != null) unit = unitNet;
  else if (amount != null && (unit == null || !close(unit * q, amount))) unit = Math.round((amount / q) * 100) / 100;
  if (unit != null && clientPrice != null && close(unit, clientPrice) && amount != null && !close(clientPrice * q, amount)) {
    unit = Math.round((amount / q) * 100) / 100;
  }
  return {
    reference: pick(l, ["reference", "physical_reference", "ref", "part_number", "reference_article", "code_article", "cod_article", "article_code", "code", "sku"]),
    label: pick(l, ["label", "designation", "description", "libelle", "name"]),
    quantity,
    unit_price: unit,
    discount_pct: num(l.discount_pct),
    amount,
    delay: pick(l, ["delay", "delivery", "delivery_info", "availability"]),
    isolated_number: str(l["isolated_number"]),
    client_price: clientPrice,
  };
}

function supplierInfo(v: unknown): SupplierInfo | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Raw;
  const out: SupplierInfo = {};
  for (const k of ["address", "postal_code", "city", "phone", "email", "website", "siret", "vat_number"] as const) {
    const x = str(o[k]);
    if (x) out[k] = x;
  }
  return Object.keys(out).length ? out : null;
}

export function normalizePurchaseExtract(input: unknown): InvoiceExtract {
  const o = (input && typeof input === "object" ? input : {}) as Raw;
  const rawLines = Array.isArray(o.lines) ? (o.lines as Raw[]) : [];
  let lines = rawLines.filter((l) => l && typeof l === "object").map(normLine).filter((l) => l.reference || l.label);
  const totalHt = num(o.total_ht);

  // Cohérence globale : si les montants nets somment au total HT, ils fixent le PA unitaire.
  const sumNet = lines.reduce((s, l) => s + (l.amount ?? 0), 0);
  if (totalHt != null && lines.length && lines.every((l) => l.amount != null) && close(sumNet, totalHt)) {
    lines = lines.map((l) => ({ ...l, unit_price: Math.round(((l.amount ?? 0) / (l.quantity && l.quantity > 0 ? l.quantity : 1)) * 100) / 100 }));
  }
  // Une seule ligne sans montant mais total HT présent : PA = total / qté si le prix lu est incohérent.
  if (totalHt != null && lines.length === 1 && lines[0]!.amount == null) {
    const l = lines[0]!;
    const q = l.quantity && l.quantity > 0 ? l.quantity : 1;
    if (l.unit_price == null || !close(l.unit_price * q, totalHt)) lines = [{ ...l, unit_price: Math.round((totalHt / q) * 100) / 100 }];
  }

  // Plaque : seulement si réellement imprimée sur le document.
  const platePrinted = o.plate_printed === true || o.plate_printed === "true";
  const kind = str(o.doc_kind);
  // « Repère / Mes références / Réf. client / Véhicule » peut être une immatriculation : jamais un OR.
  const refFields = ["or_number", "customer_reference", "order_mark", "repere_commande", "vehicle", "mes_references"];
  let orRaw: string | null = null;
  let refPlate: string | null = null;
  for (const k of refFields) {
    const v = str(o[k]);
    if (!v) continue;
    const p = findFrenchPlate(v);
    if (p) { refPlate ??= p; continue; }
    orRaw ??= v;
  }
  let orNumber = digits(orRaw);
  const docNumber = str(o.document_number);
  if (!orNumber) {
    orNumber = isolatedOrNumber(lines, [docNumber, str(o.delivery_note_number), str(o.invoice_number), str(o["order_reference"]), str(o["order_number"])]);
  }
  // Ne jamais confondre Repère commande / OR avec « Commande n° ».
  let orderRef = pick(o, ["order_reference", "order_number", "supplier_order_number"]);
  const sameAsOr = (v: string | null) => !!v && !!orNumber && digits(v) === orNumber;
  if (sameAsOr(orderRef)) orderRef = null;
  // Repère court 5/6 chiffres (« Commande *****50320 ») = dossier/OR atelier par défaut, pas un n° fournisseur.
  if (!orNumber && orderRef) {
    const compact = orderRef.replace(/[\s*#.:°\-]/g, "").replace(/^(n|no|num)/i, "");
    const docNums = [docNumber, str(o.delivery_note_number), str(o.invoice_number)].map((v) => (v ?? "").replace(/\D/g, ""));
    if (/^\d{5,6}$/.test(compact) && !docNums.includes(compact)) {
      orNumber = compact;
      orderRef = null;
    }
  }
  if (!orderRef && kind === "commande" && docNumber && !sameAsOr(docNumber)) orderRef = docNumber;
  // Repères OR multiples (commande multi-OR) : 5-6 chiffres, jamais le n° de commande/document.
  const notOr = new Set([orderRef, docNumber, str(o.delivery_note_number), str(o.invoice_number)].map((v) => (v ?? "").replace(/\D/g, "")).filter(Boolean));
  const orNumbers = [...new Set([orNumber, ...(Array.isArray(o["or_numbers"]) ? (o["or_numbers"] as unknown[]).map((v) => digits(str(v))) : [])]
    .filter((v): v is string => !!v && /^\d{5,6}$/.test(v) && !notOr.has(v)))].slice(0, 8);
  if (!orNumber && orNumbers.length) orNumber = orNumbers[0]!;
  return {
    doc_kind: kind,
    supplier: pick(o, ["supplier", "distributor", "distributeur", "vendor", "seller"]),
    supplier_info: supplierInfo(o["supplier_info"]),
    document_number: docNumber,
    document_date: str(o.document_date),
    order_date: str(o["order_date"]),
    order_reference: orderRef,
    ref_candidates: Array.isArray(o["ref_candidates"]) ? [...new Set((o["ref_candidates"] as unknown[]).map((v) => str(v)).filter((v): v is string => !!v))].slice(0, 12) : [],
    delivery_note_number: str(o.delivery_note_number),
    invoice_number: str(o.invoice_number),
    invoice_date: str(o.invoice_date),
    or_number: orNumber,
    or_numbers: orNumbers,
    plate: (platePrinted && str(o.plate) ? findFrenchPlate(str(o.plate)) ?? str(o.plate) : null)
      ?? refPlate
      ?? findFrenchPlate([str(o.handwritten_notes), ...lines.map((l) => l.label)].filter(Boolean).join(" | ")),
    customer_or_site: str(o.customer_or_site),
    lines: lines.map(({ client_price: _c, isolated_number: _i, ...l }) => l),
    total_ht: totalHt,
    vat_amount: num(o.vat_amount),
    shipping_ht: num(o["shipping_ht"]),
    shipping_label: str(o["shipping_label"]),
    total_ttc: num(o.total_ttc),
    handwritten_notes: str(o.handwritten_notes),
  };
}

/** Second passage ciblé (identifiants atelier) : {plate, or_number, order_reference, evidence}. Une immat n'est jamais un OR. */
export function parseIdentifierPass(input: unknown): { plate: string | null; or_number: string | null; order_reference: string | null; evidence: string | null } {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === "string" || typeof o[k] === "number" ? String(o[k]).trim() || null : null);
  let plate = s("plate") ? findFrenchPlate(s("plate")) : null;
  let or: string | null = null;
  const orRaw = s("or_number");
  if (orRaw) {
    const p = findFrenchPlate(orRaw);
    if (p) plate ??= p;
    else if (/^\D*\d{4,8}\D*$/.test(orRaw)) or = orRaw.replace(/\D/g, "");
  }
  return { plate, or_number: or, order_reference: s("order_reference"), evidence: s("evidence") };
}

/** Fusionne le second passage dans le premier : ne remplit que les champs manquants, n'écrase jamais une valeur existante. */
export function mergeIdentifierPass<T extends { plate?: string | null; or_number?: string | null; order_reference?: string | null }>(first: T, second: ReturnType<typeof parseIdentifierPass>): T {
  const out = { ...first };
  if (!out.plate && second.plate) out.plate = second.plate;
  const excluded = [first.order_reference ?? null, (first as Record<string, unknown>)["delivery_note_number"], (first as Record<string, unknown>)["document_number"], (first as Record<string, unknown>)["invoice_number"]].map((v) => (typeof v === "string" ? v.replace(/\D/g, "") : ""));
  if (!out.or_number && second.or_number && !excluded.includes(second.or_number)) out.or_number = second.or_number;
  if (!out.order_reference && second.order_reference && second.order_reference.replace(/\D/g, "") !== (out.or_number ?? "")) out.order_reference = second.order_reference;
  return out;
}

/** Faut-il relancer un second passage ciblé ? Oui si ni immat ni OR n'ont été lus. */
export function needsIdentifierPass(x: { plate?: string | null; or_number?: string | null }): boolean {
  return !x.plate && !x.or_number;
}
