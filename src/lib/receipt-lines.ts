/** Pièces & achats — helpers purs : n° dossier/OR visible, lignes BL éditables, aperçu PJ, mail détaillé. */
import type { ReceiptLineInput } from "@/lib/parts";

/** Synchronise le n° OR visible avec un n° lu arrivé après coup, sans écraser une saisie utilisateur. */
export function syncOrNumber(current: string, touched: boolean, incoming: string | null | undefined): string {
  const v = (incoming ?? "").trim();
  if (touched || !v || v === current) return current;
  return v;
}

export const blankReceiptLine = (): ReceiptLineInput => ({ order_line_id: null, physical_reference: "", designation: "", qty_expected: null, qty_received: 1, condition: "usable", destination: "or", allocate_qty: 1, unit_cost: null, expected_cost: null, ordered_reference: null, comment: "" });

type DocLine = { reference?: string | null; label?: string | null; quantity?: number | null; unit_price?: number | null };

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
