/**
 * Contrôles déterministes d'une lecture de document d'achat (BL / facture / commande).
 * Pure et testable : aucune règle propre à un fournisseur. Sert de garde-fou après la vision IA
 * (photos) comme après les règles OCR (PDF texte) : une valeur incohérente est SIGNALÉE, jamais validée en silence.
 */
type L = {
  reference?: string | null;
  label?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  amount?: number | null;
  discount_pct?: number | null;
  gross_unit_price?: number | null;
  vat_pct?: number | null;
  line_kind?: string | null;
};
type X = { lines?: L[] | null; total_ht?: number | null; vat_amount?: number | null; total_ttc?: number | null; shipping_ht?: number | null };

export type PurchaseCheck = { ok: boolean; alerts: string[]; suspectLines: number[]; suspectFields: string[] };

const eur = (n: number) => n.toFixed(2).replace(".", ",");
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function validatePurchase(x: X): PurchaseCheck {
  const alerts: string[] = [];
  const suspect = new Set<number>();
  const fields = new Set<string>();
  const lines = x.lines ?? [];
  const ttc = isNum(x.total_ttc) ? x.total_ttc : null;
  const ht = isNum(x.total_ht) ? x.total_ht : null;
  const ceiling = Math.max(ht ?? 0, ttc ?? 0);

  lines.forEach((l, i) => {
    const tag = `Ligne ${i + 1}${l.reference ? ` (${l.reference})` : ""}`;
    const q = l.quantity;
    if (q != null && (!(q > 0) || q > 999)) { suspect.add(i); alerts.push(`${tag} : quantité ${q} non plausible`); }
    // Taux de TVA pris pour une quantité : qté = taux et montant cohérent avec qté 1.
    if (q != null && q > 1 && isNum(l.vat_pct) && q === l.vat_pct) { suspect.add(i); alerts.push(`${tag} : quantité ${q} identique au taux de TVA`); }
    const qq = q && q > 0 ? q : 1;
    if (isNum(l.gross_unit_price) && isNum(l.discount_pct) && isNum(l.amount)) {
      const exp = l.gross_unit_price * qq * (1 - l.discount_pct / 100);
      if (!near(exp, l.amount, Math.max(0.02 * qq, 0.03))) { suspect.add(i); alerts.push(`${tag} : tarif ${eur(l.gross_unit_price)} − ${l.discount_pct} % × ${qq} ≠ montant ${eur(l.amount)}`); }
    }
    if (isNum(l.unit_price) && isNum(l.amount) && !near(l.unit_price * qq, l.amount, Math.max(0.02 * qq, 0.03))) {
      suspect.add(i); alerts.push(`${tag} : PU ${eur(l.unit_price)} × ${qq} ≠ montant ${eur(l.amount)}`);
    }
    // Prix aberrant face au total du document (ex. remise collée au montant : 4 500 109,88 €).
    for (const v of [l.unit_price, l.amount]) {
      if (isNum(v) && ceiling > 0 && v > ceiling * 1.05 + 1) { suspect.add(i); alerts.push(`${tag} : prix ${eur(v)} € supérieur au total du document`); break; }
    }
  });

  const amounts = lines.map((l) => l.amount);
  if (ht != null && lines.length && amounts.every(isNum)) {
    const sum = (amounts as number[]).reduce((s, v) => s + v, 0) + (isNum(x.shipping_ht) ? x.shipping_ht : 0);
    const sumNoShip = (amounts as number[]).reduce((s, v) => s + v, 0);
    const tol = Math.max(0.05, 0.02 * lines.length);
    if (!near(sum, ht, tol) && !near(sumNoShip, ht, tol)) {
      fields.add("total_ht");
      alerts.push(`Somme des lignes ${eur(sumNoShip)} € ≠ total HT ${eur(ht)} €`);
      lines.forEach((_, i) => suspect.add(i));
    }
  }
  // Totaux de pied lus (TVA / TTC) mais total HT absent : lecture incomplète, jamais fiable.
  if (ht == null && (isNum(x.vat_amount) || ttc != null) && lines.length) {
    fields.add("total_ht");
    alerts.push("Total HT non lu alors que TVA / TTC sont présents");
  }
  if (ht != null && isNum(x.vat_amount) && ttc != null && !near(ht + x.vat_amount, ttc, 0.05)) {
    fields.add("total_ttc");
    alerts.push(`Total HT ${eur(ht)} + TVA ${eur(x.vat_amount)} ≠ TTC ${eur(ttc)}`);
  }
  if (suspect.size) fields.add("lines");
  return { ok: !alerts.length, alerts: [...new Set(alerts)], suspectLines: [...suspect].sort((a, b) => a - b), suspectFields: [...fields] };
}

/** Ligne de frais (port, emballage, transport…) : comptée dans les totaux, jamais rapprochée comme une pièce. */
const FEE_RE = /^(?:frais\s+(?:de\s+)?(?:port|transport|livraison|envoi|emballage|expedition|exp[ée]dition)|port(?:\s+(?:et|&)\s+emballage)?|port\s+ht|transport|emballage|participation\s+(?:aux\s+)?frais.*|frais\s+fixes?.*)$/i;
export function classifyLineKind(l: { reference?: string | null; label?: string | null; line_kind?: string | null; amount?: number | null; quantity?: number | null; unit_price?: number | null }): "part" | "fee" | "info" {
  const k = (l.line_kind ?? "").toLowerCase();
  if (k === "fee" || k === "info") return k;
  const t = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (FEE_RE.test(t(l.label)) || FEE_RE.test(t(l.reference))) return "fee";
  if (/^\*+\s*B\.?L\b/i.test(t(l.label)) || /^\*+\s*B\.?L\b/i.test(t(l.reference))) return "info";
  return "part";
}
export const isFeeLine = (l: Parameters<typeof classifyLineKind>[0]) => classifyLineKind(l) === "fee";
/** Lignes à rapprocher des commandes : pièces uniquement (frais et lignes d'information exclus). */
export const partLinesOnly = <T extends Parameters<typeof classifyLineKind>[0]>(lines: T[] | null | undefined): T[] => (lines ?? []).filter((l) => classifyLineKind(l) === "part");

/** N° de document en forme de date (« 10/2026 », « 16/10/2026 ») : jamais un n° de facture / BL. */
export function isDateLikeNumber(v: string | null | undefined): boolean {
  const s = (v ?? "").trim();
  return /^\d{1,2}[/.\-]\d{2,4}$/.test(s) || /^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/.test(s);
}

/**
 * Lecture à vérifier (fail-closed) pour une photo / un scan image : vision en échec, contrôles chiffrés en échec
 * après relecture, aucune ligne, ou n° / date de document absents.
 */
export function reviewReasons(x: X & { invoice_number?: string | null; delivery_note_number?: string | null; document_number?: string | null; document_date?: string | null; supplier?: string | null }, opts: { visionFailed: boolean }): string[] {
  const out: string[] = [];
  if (opts.visionFailed) out.push("Lecture IA impossible : données issues de l'OCR seul");
  const c = validatePurchase(x);
  if (!c.ok) out.push("Contrôles chiffrés en échec");
  if (!(x.lines ?? []).length) out.push("Aucune ligne lue");
  if (!(x.invoice_number || x.delivery_note_number || x.document_number)) out.push("N° de document non lu");
  if (!x.document_date) out.push("Date du document non lue");
  if (!x.supplier) out.push("Fournisseur non lu");
  return out;
}

const blank = (v: unknown) => v == null || v === "" || (Array.isArray(v) && !v.length);

/**
 * Fusion « vision d'abord » : la lecture vision est prioritaire ; les règles déterministes ne complètent
 * que les champs absents de la vision et jugés fiables (jamais un champ suspect des règles).
 * Les lignes des règles ne remplacent celles de la vision que si la vision n'en a lu aucune.
 */
export function mergeVisionFirst(vision: Record<string, unknown>, rules: Record<string, unknown>, rulesSuspect: string[] = []): { fields: Record<string, unknown>; completed: string[]; conflicts: string[] } {
  const out: Record<string, unknown> = { ...vision };
  const completed: string[] = [];
  const conflicts: string[] = [];
  const norm = (v: unknown) => String(v ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  for (const [k, v] of Object.entries(rules)) {
    if (k.startsWith("_") || blank(v)) continue;
    if (rulesSuspect.includes(k)) continue;
    // Les règles ne fournissent jamais le fournisseur d'une photo (en-tête lu par la vision) ni un n° en forme de date.
    if (k === "supplier" || k === "supplier_info") { if (!blank(out[k]) && typeof v !== "object" && norm(v) !== norm(out[k])) conflicts.push(k); continue; }
    if (["invoice_number", "delivery_note_number", "document_number"].includes(k) && isDateLikeNumber(String(v))) continue;
    if (blank(out[k])) { out[k] = v; completed.push(k); continue; }
    if (["delivery_note_number", "invoice_number", "document_date", "total_ht"].includes(k) && typeof v !== "object" && norm(v) !== norm(out[k])) conflicts.push(k);
  }
  return { fields: out, completed, conflicts };
}

/** Relecture ciblée nécessaire : vision nulle, contrôles en échec, aucune ligne, ou TVA/TTC lus sans total HT. */
export function needsLinesRecheck(x: X & { control_alerts?: string[] }, visionFailed: boolean): boolean {
  if (visionFailed) return true;
  if (!(x.lines ?? []).length) return true;
  if (x.total_ht == null && (isNum(x.vat_amount) || isNum(x.total_ttc))) return true;
  return !!x.control_alerts?.length || !validatePurchase(x).ok;
}

/**
 * Relecture ciblée (lignes + totaux) après échec des contrôles : retenue seulement si ELLE passe les contrôles.
 * Sinon la première lecture reste, avec ses alertes « Lecture à vérifier ».
 */
export function pickRecheck<T extends X & { control_alerts?: string[]; suspect_lines?: number[] }>(first: T, recheck: X | null): { value: T; used: boolean } {
  if (!recheck || !(recheck.lines ?? []).length || recheck.total_ht == null) return { value: first, used: false };
  const c = validatePurchase(recheck);
  if (!c.ok) return { value: first, used: false };
  const { control_alerts: _a, suspect_lines: _s, ...rest } = first;
  return {
    value: { ...rest, lines: recheck.lines, total_ht: recheck.total_ht ?? first.total_ht, vat_amount: recheck.vat_amount ?? first.vat_amount, total_ttc: recheck.total_ttc ?? first.total_ttc } as T,
    used: true,
  };
}
