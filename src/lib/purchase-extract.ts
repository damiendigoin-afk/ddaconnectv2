/**
 * Post-traitement générique d'un document d'achat lu par OCR (commande, BL, facture).
 * Aucune règle propre à un fournisseur : alias de libellés courants + cohérence des prix avec le total HT.
 */
import type { InvoiceExtract, InvoiceLine, SupplierInfo } from "@/lib/supplier-docs";

type Raw = Record<string, unknown> & Partial<Record<"doc_kind"|"document_number"|"document_date"|"delivery_note_number"|"invoice_number"|"invoice_date"|"plate"|"plate_printed"|"customer_or_site"|"total_ht"|"vat_amount"|"total_ttc"|"handwritten_notes"|"lines"|"quantity"|"qty"|"qte"|"amount"|"net_amount"|"line_total_ht"|"montant_net"|"net_unit_price"|"unit_net_price"|"client_price"|"public_price"|"list_price"|"unit_price"|"price"|"discount_pct", unknown>>;

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
  const quantity = num(l.quantity ?? l.qty ?? l.qte) ?? null;
  const amount = num(l.amount ?? l.net_amount ?? l.line_total_ht ?? l.montant_net ?? l.total_ht);
  const unitNet = num(l.net_unit_price ?? l.unit_net_price);
  const clientPrice = num(l.client_price ?? l.public_price ?? l.list_price);
  let unit = num(l.unit_price ?? l.price);
  const q = quantity && quantity > 0 ? quantity : 1;
  if (unitNet != null) unit = unitNet;
  else if (amount != null && (unit == null || !close(unit * q, amount))) unit = Math.round((amount / q) * 100) / 100;
  if (unit != null && clientPrice != null && close(unit, clientPrice) && amount != null && !close(clientPrice * q, amount)) {
    unit = Math.round((amount / q) * 100) / 100;
  }
  return {
    reference: pick(l, ["reference", "ref", "part_number", "reference_article"]),
    label: pick(l, ["label", "designation", "description"]),
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
  let orNumber = digits(pick(o, ["or_number", "customer_reference", "order_mark", "repere_commande"]));
  const docNumber = str(o.document_number);
  if (!orNumber) {
    orNumber = isolatedOrNumber(lines, [docNumber, str(o.delivery_note_number), str(o.invoice_number), str(o["order_reference"]), str(o["order_number"])]);
  }
  // Ne jamais confondre Repère commande / OR avec « Commande n° ».
  let orderRef = pick(o, ["order_reference", "order_number", "supplier_order_number"]);
  const sameAsOr = (v: string | null) => !!v && !!orNumber && digits(v) === orNumber;
  if (sameAsOr(orderRef)) orderRef = null;
  if (!orderRef && kind === "commande" && docNumber && !sameAsOr(docNumber)) orderRef = docNumber;
  return {
    doc_kind: kind,
    supplier: pick(o, ["supplier", "distributor", "distributeur", "vendor", "seller"]),
    supplier_info: supplierInfo(o["supplier_info"]),
    document_number: docNumber,
    document_date: str(o.document_date),
    order_reference: orderRef,
    delivery_note_number: str(o.delivery_note_number),
    invoice_number: str(o.invoice_number),
    invoice_date: str(o.invoice_date),
    or_number: orNumber,
    plate: platePrinted ? str(o.plate) : null,
    customer_or_site: str(o.customer_or_site),
    lines: lines.map(({ client_price: _c, isolated_number: _i, ...l }) => l),
    total_ht: totalHt,
    vat_amount: num(o.vat_amount),
    total_ttc: num(o.total_ttc),
    handwritten_notes: str(o.handwritten_notes),
  };
}
