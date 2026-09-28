/** Pièces & achats — helpers purs : n° dossier/OR visible, lignes BL éditables, aperçu PJ, mail détaillé. */
import type { OrderLineInput, ReceiptLineInput } from "@/lib/parts";

/** Synchronise le n° OR visible avec un n° lu arrivé après coup, sans écraser une saisie utilisateur. */
export function syncOrNumber(current: string, touched: boolean, incoming: string | null | undefined): string {
  const v = (incoming ?? "").trim();
  if (touched || !v || v === current) return current;
  return v;
}

export const blankReceiptLine = (): ReceiptLineInput => ({ order_line_id: null, physical_reference: "", designation: "", qty_expected: null, qty_received: 1, condition: "usable", destination: "or", allocate_qty: 1, unit_cost: null, expected_cost: null, ordered_reference: null, comment: "" });

type DocLine = { reference?: string | null; label?: string | null; quantity?: number | null; unit_price?: number | null };

/** Lignes lues sur une commande → lignes de commande directement éditables. */
export function orderLinesFromDoc(lines: (DocLine & { delay?: string | null })[] | null | undefined): OrderLineInput[] {
  return (lines ?? [])
    .filter((l) => l.reference || l.label)
    .map((l) => ({
      line_kind: "part",
      physical_reference: l.reference ?? "",
      designation: [l.label, l.delay ? `(délai : ${l.delay})` : ""].filter(Boolean).join(" "),
      qty_ordered: l.quantity ?? 1,
      expected_unit_cost_ht: l.unit_price ?? null,
    }));
}

export type PendingOrderLine = {
  id?: string;
  line_kind?: string;
  physical_reference?: string | null;
  designation?: string | null;
  qty_ordered?: number | null;
  qty_received?: number | null;
  expected_unit_cost_ht?: number | null;
  status?: string;
};

/** Quantités d'une ligne en attente, utilisées à l'identique dans les listes et la réception. */
export function pendingOrderLineMetrics(line: PendingOrderLine) {
  const ordered = line.qty_ordered == null ? null : Number(line.qty_ordered);
  const received = Number(line.qty_received ?? 0);
  return { ordered, received, remaining: ordered == null ? null : Math.max(0, ordered - received) };
}

/** Toutes les lignes de pièces non soldées d'une commande, préremplies avec leur reliquat. */
export function receiptLinesFromOrder(lines: PendingOrderLine[], destination: ReceiptLineInput["destination"]): ReceiptLineInput[] {
  return lines
    .filter((line) => line.line_kind === "part" && line.status !== "received")
    .map((line) => {
      const qty = pendingOrderLineMetrics(line);
      const remaining = qty.remaining ?? 1;
      return {
        ...blankReceiptLine(),
        order_line_id: line.id ?? null,
        physical_reference: line.physical_reference ?? "",
        ordered_reference: line.physical_reference ?? null,
        designation: line.designation ?? "",
        qty_expected: remaining,
        qty_ordered: qty.ordered,
        qty_already_received: qty.received,
        qty_received: remaining,
        allocate_qty: remaining,
        expected_cost: line.expected_unit_cost_ht ?? null,
        unit_cost: line.expected_unit_cost_ht ?? null,
        destination,
      };
    });
}

/** Lignes lues sur le BL → lignes éditables (réf, désignation, qté lue/reçue, PA HT). */
export function receiptLinesFromDoc(lines: DocLine[] | null | undefined): ReceiptLineInput[] {
  return (lines ?? [])
    .filter((l) => l.reference || l.label)
    .map((l) => ({ ...blankReceiptLine(), physical_reference: l.reference ?? "", designation: l.label ?? "", qty_expected: l.quantity ?? null, qty_received: l.quantity ?? 1, allocate_qty: l.quantity ?? 1, unit_cost: l.unit_price ?? null }));
}

/** Anomalies affichées sur la ligne elle-même. */
export function lineAnomalies(l: ReceiptLineInput): string[] {
  const out: string[] = [];
  const n = (s: string) => s.replace(/\W/g, "").toUpperCase();
  if (l.ordered_reference && l.physical_reference && n(l.ordered_reference) !== n(l.physical_reference)) out.push(`Réf. commandée ${l.ordered_reference}`);
  if (l.qty_expected != null && l.qty_received !== l.qty_expected) out.push(`Qté attendue ${l.qty_expected}`);
  if (l.unit_cost != null && l.expected_cost != null && Math.abs(l.unit_cost - l.expected_cost) > 0.009) out.push(`PA attendu ${l.expected_cost}`);
  return out;
}

type FetchResult = { ok: true; filename: string; mime: string; base64: string } | { ok: false; message: string };

/** Aperçu d'une PJ : récupère le fichier et l'ouvre — ne crée jamais de document DDA. */
export async function previewAttachment(fetchFile: (id: string) => Promise<FetchResult>, id: string, open: (blob: Blob, filename: string) => void): Promise<{ ok: true } | { ok: false; message: string }> {
  const r = await fetchFile(id);
  if (!r.ok) return { ok: false, message: r.message };
  const bin = atob(r.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  open(new Blob([bytes], { type: r.mime }), r.filename);
  return { ok: true };
}

export type MailFull = { subject: string | null; from_name: string | null; from_address: string | null; sent_at: string; to_addresses?: string[] | null; cc_addresses?: string[] | null; body_text?: string | null; snippet?: string | null };

/** Données du mail complet affichées localement (pas de navigation vers Flux e-mails). */
export function mailDetail(m: MailFull) {
  return {
    subject: m.subject || "(sans objet)",
    from: m.from_name ? `${m.from_name} <${m.from_address ?? ""}>` : m.from_address ?? "",
    date: new Date(m.sent_at).toLocaleString("fr-FR"),
    to: (m.to_addresses ?? []).join(", "),
    cc: (m.cc_addresses ?? []).join(", "),
    body: (m.body_text ?? "").trim() || (m.snippet ?? "").trim() || "(corps vide)",
  };
}

type OrderLike = { repair_orders?: { or_number?: string | null } | null; requested_or_number?: string | null; plate?: string | null; supplier_order_ref?: string | null };

/** Repère d'une commande : OR DDA > dossier lu (requested_or_number) > plaque > « sans repère ». Jamais « sans OR » si un dossier existe. */
export function orderMarker(o: OrderLike): string {
  const parts: string[] = [];
  const orN = o.repair_orders?.or_number?.trim();
  const req = o.requested_or_number?.trim();
  if (orN) parts.push(`OR ${orN}`);
  else if (req) parts.push(`Dossier / OR WinMotor ${req}`);
  if (o.plate?.trim()) parts.push(o.plate.trim());
  if (!parts.length) parts.push("sans repère");
  if (o.supplier_order_ref?.trim()) parts.push(`commande ${o.supplier_order_ref.trim()}`);
  return parts.join(" · ");
}

const normTxt = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\W/g, "").toUpperCase();

type DocLike = { id: string; site_id: string | null; created_at: string; extracted: { supplier?: string | null; doc_kind?: string | null; document_number?: string | null; order_reference?: string | null; or_number?: string | null; lines?: DocLine[] | null } };

/** Identité canonique stricte : site + fournisseur + type + n° + dossier + lignes. */
export function docIdentity(d: DocLike): string {
  const x = d.extracted ?? {};
  const lines = (x.lines ?? []).map((l) => `${normTxt(l.reference)}:${normTxt(l.label)}:${l.quantity ?? ""}:${l.unit_price ?? ""}`).join("|");
  return [d.site_id ?? "", normTxt(x.supplier), normTxt(x.doc_kind), normTxt(x.document_number ?? x.order_reference), normTxt(x.or_number), lines].join("#");
}

/** Une seule carte par document strictement identique (le plus récent gagne). */
export function dedupeDocs<T extends DocLike>(docs: T[]): T[] {
  const seen = new Map<string, T>();
  for (const d of [...docs].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const k = docIdentity(d);
    if (!seen.has(k)) seen.set(k, d);
  }
  const keep = new Set([...seen.values()].map((d) => d.id));
  return docs.filter((d) => keep.has(d.id));
}

/** Nom de fichier sûr pour le stockage, en conservant le nom original et son extension. */
export function storageFileName(name: string): string {
  const n = name.replace(/[\\/?#%*:|"<>\u0000-\u001f]+/g, "_").trim();
  return (n || "piece-jointe").slice(-150);
}

const EXT_MIME: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", tif: "image/tiff", tiff: "image/tiff" };
/** Type MIME fiable : celui connu, sinon déduit de l'extension. */
export function mimeFor(name: string, mime?: string | null): string {
  if (mime && mime !== "application/octet-stream") return mime;
  return EXT_MIME[(name.split(".").pop() ?? "").toLowerCase()] ?? mime ?? "application/octet-stream";
}

/** Repère libre par défaut : jamais tiré de handwritten_notes (coches/couleurs OCR) ; seul un vrai champ explicite compte. */
export function defaultFreeReference(x: { customer_reference?: string | null } | null | undefined): string {
  return (x?.customer_reference ?? "").trim();
}

/** Lignes après choix d'une commande : lignes de commande si elle en a, sinon lignes du BL (jamais effacées), sinon ligne vide. */
export function linesAfterOrderPick(orderLines: PendingOrderLine[], docLines: DocLine[] | null | undefined, destination: ReceiptLineInput["destination"]): ReceiptLineInput[] {
  const fromOrder = receiptLinesFromOrder(orderLines, destination);
  if (orderLines.some((l) => l.line_kind === "part")) return fromOrder.length ? fromOrder : [{ ...blankReceiptLine(), destination }];
  const fromDoc = receiptLinesFromDoc(docLines).map((l) => ({ ...l, destination }));
  return fromDoc.length ? fromDoc : [{ ...blankReceiptLine(), destination }];
}

/** Lignes de commande à créer pour tracer une commande simplifiée sans lignes (choix explicite requis). */
export function simplifiedEnrichment(order: { order_mode?: string | null; line_count: number } | null, lines: ReceiptLineInput[]): ReceiptLineInput[] {
  if (!order || order.order_mode !== "simplified" || order.line_count > 0) return [];
  return lines.filter((l) => !l.order_line_id && l.qty_received > 0 && (l.physical_reference.trim() || l.designation.trim()));
}
