/** Pré-classification locale (0 crédit) par mots-clés du texte OCR / PDF. Pur. */
import type { BenchKind } from "./bench-schema";

const RULES: { kind: BenchKind; re: RegExp[] }[] = [
  { kind: "credit_note", re: [/\bavoir\b/i, /note de cr[ée]dit/i] },
  { kind: "supplier_invoice", re: [/\bfacture\b/i, /n[°o]\s*facture/i] },
  { kind: "delivery_note", re: [/bon de livraison/i, /\bB\.?L\.?\s*n/i, /\bBL\b/] },
  { kind: "purchase_order", re: [/bon de commande/i, /commande\s*(n[°o]|du)/i, /confirmation de commande/i] },
  { kind: "repair_order", re: [/ordre de r[ée]paration/i, /\bO\.?R\.?\s*n[°o]/i, /travaux [àa] effectuer/i, /remarque du client/i] },
  { kind: "battery", re: [/\bCCA\b/, /\bSOH\b/i, /\bSOC\b/i, /test(eur)? batterie/i, /midtronics/i] },
  { kind: "tire", re: [/\b\d{3}\/\d{2}\s?Z?R\s?\d{2}\b/, /\bDOT\b/, /\b3PMSF\b/i] },
  { kind: "expense_receipt", re: [/ticket/i, /carburant|gazole|sp95|sp98|e10/i, /\bCB\b|carte bancaire/i] },
];

export function classifyLocal(text: string | null | undefined): { kind: BenchKind; confidence: number } | null {
  const t = (text ?? "").slice(0, 20000);
  if (t.replace(/\s/g, "").length < 20) return null;
  const scored = RULES.map((r) => ({ kind: r.kind, hits: r.re.filter((x) => x.test(t)).length }))
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  if (!scored.length) return { kind: "auto_unknown", confidence: 0.3 };
  const [best, second] = scored;
  const margin = best!.hits - (second?.hits ?? 0);
  const confidence = Math.min(0.95, 0.45 + best!.hits * 0.15 + margin * 0.1);
  return { kind: best!.kind, confidence: Math.round(confidence * 100) / 100 };
}

/** Classification jugée assez sûre pour éviter un appel IA. */
export const LOCAL_CLASSIFY_THRESHOLD = 0.75;
