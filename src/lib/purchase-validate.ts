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
  if (ht != null && isNum(x.vat_amount) && ttc != null && !near(ht + x.vat_amount, ttc, 0.05)) {
    fields.add("total_ttc");
    alerts.push(`Total HT ${eur(ht)} + TVA ${eur(x.vat_amount)} ≠ TTC ${eur(ttc)}`);
  }
  if (suspect.size) fields.add("lines");
  return { ok: !alerts.length, alerts: [...new Set(alerts)], suspectLines: [...suspect].sort((a, b) => a - b), suspectFields: [...fields] };
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
    if (blank(out[k])) { out[k] = v; completed.push(k); continue; }
    if (["supplier", "delivery_note_number", "document_date", "total_ht"].includes(k) && typeof v !== "object" && norm(v) !== norm(out[k])) conflicts.push(k);
  }
  return { fields: out, completed, conflicts };
}
