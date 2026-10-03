/**
 * Bon de commande Renault « Détail de commande » : complétude après règles dédiées,
 * prompt IA court et fusion par référence (repli unique Gemini 3.8 Flash).
 */
import type { Fields } from "./doc-rules";

export const RENAULT_TEMPLATE = "renault_detail_commande";

type L = { reference?: unknown; label?: unknown; quantity?: unknown; unit_price?: unknown; amount?: unknown };
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) { const n = Number(v.replace(/\s|€/g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; }
  return null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const refKey = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const eur = (n: number) => n.toFixed(2).replace(".", ",");

/** Lecture incomplète = fournisseur, désignation, quantité ou PA absent, ou alerte de contrôle. */
export function renaultIncomplete(f: Fields): boolean {
  if (f["template"] !== RENAULT_TEMPLATE) return false;
  const lines = (Array.isArray(f["lines"]) ? f["lines"] : []) as L[];
  const alerts = Array.isArray(f["control_alerts"]) ? f["control_alerts"] : [];
  return !str(f["supplier"]) || !lines.length || alerts.length > 0
    || lines.some((l) => !str(l.label) || num(l.quantity) == null || num(l.unit_price) == null);
}

export const RENAULT_AI_PROMPT = `Document : bon « Détail de commande » du portail Renault. Réponds UNIQUEMENT en JSON compact :
{"supplier":string|null,"order_reference":string|null,"or_number":string|null,"plate":string|null,"lines":[{"reference":string,"label":string|null,"quantity":number|null,"unit_price":number|null}],"total_ht":number|null,"vat_amount":number|null,"total_ttc":number|null}
Règles : supplier = valeur du champ « Distributeur », jamais le client ni l'adresse de facturation (Ville, Adresse…). or_number = « Repère commande ». unit_price = PA HT, montant HT de DROITE de chaque article, jamais « Prix client ». Ne rien inventer : null si illisible.`;

/** Recalcule anomalies de ligne, écart au Total HT et fournisseur. */
export function renaultControls(f: Fields): Fields {
  const lines = (Array.isArray(f["lines"]) ? f["lines"] : []) as L[];
  const alerts: string[] = [];
  lines.forEach((l, i) => {
    const miss = [!str(l.reference) ? "référence" : "", !str(l.label) ? "désignation" : "", num(l.quantity) == null ? "quantité" : "", num(l.unit_price) == null ? "PA HT" : ""].filter(Boolean);
    if (miss.length) alerts.push(`Ligne ${i + 1}${str(l.reference) ? ` (${l.reference})` : ""} incomplète : ${miss.join(", ")} à corriger`);
  });
  const sum = Math.round(lines.reduce((t, l) => t + (num(l.unit_price) ?? 0) * (num(l.quantity) ?? 1), 0) * 100) / 100;
  const total = num(f["total_ht"]);
  if (total != null && Math.abs(sum - total) > 0.02) alerts.push(`Écart de contrôle : somme des PA ${eur(sum)} € ≠ Total HT ${eur(total)} €`);
  if (!str(f["supplier"])) alerts.push("Distributeur illisible : fournisseur à choisir");
  return { ...f, control_alerts: alerts, line_quality: alerts.length ? null : "complete" };
}

/**
 * Fusion IA : complète les champs vides / suspects, lignes fusionnées par référence.
 * Les PA déterministes déjà cohérents avec le Total HT ne sont jamais écrasés.
 */
export function mergeRenaultAi(base: Fields, ai: Fields | null): Fields {
  if (!ai) return renaultControls(base);
  const baseLines = (Array.isArray(base["lines"]) ? base["lines"] : []) as L[];
  const aiLines = (Array.isArray(ai["lines"]) ? ai["lines"] : []) as L[];
  const total = num(base["total_ht"]) ?? num(ai["total_ht"]);
  const baseSum = baseLines.reduce((t, l) => t + (num(l.unit_price) ?? NaN) * (num(l.quantity) ?? 1), 0);
  const paCoherent = total != null && Number.isFinite(baseSum) && Math.abs(baseSum - total) <= 0.02;
  const byRef = new Map(aiLines.map((l) => [refKey(l.reference), l]));
  const used = new Set<string>();
  const lines = baseLines.map((l) => {
    const k = refKey(l.reference);
    const a = byRef.get(k);
    if (!a) return l;
    used.add(k);
    const unit_price = paCoherent ? num(l.unit_price) : (num(l.unit_price) ?? num(a.unit_price));
    const quantity = num(l.quantity) ?? num(a.quantity);
    return { ...l, label: str(l.label) ?? str(a.label), quantity, unit_price,
      amount: unit_price != null && quantity != null ? Math.round(unit_price * quantity * 100) / 100 : null };
  });
  for (const a of aiLines) {
    const k = refKey(a.reference);
    if (!k || used.has(k) || baseLines.some((l) => refKey(l.reference) === k)) continue;
    const unit_price = num(a.unit_price); const quantity = num(a.quantity);
    lines.push({ reference: String(a.reference).trim().toUpperCase(), label: str(a.label), quantity, unit_price,
      amount: unit_price != null && quantity != null ? Math.round(unit_price * quantity * 100) / 100 : null });
  }
  const aiSupplier = str(ai["supplier"]);
  const supplier = str(base["supplier"]) ?? (aiSupplier && !/^(ville|adresse|garage)\b/i.test(aiSupplier) ? aiSupplier.toUpperCase() : null);
  const pick = (k: string) => base[k] ?? ai[k] ?? null;
  return renaultControls({
    ...base,
    supplier,
    supplier_info: supplier ? { name: supplier } : null,
    order_reference: pick("order_reference"),
    or_number: pick("or_number"),
    plate: pick("plate"),
    total_ht: total,
    vat_amount: pick("vat_amount"),
    total_ttc: pick("total_ttc"),
    lines: lines.filter((l) => str(l.reference) || str(l.label)),
  });
}
