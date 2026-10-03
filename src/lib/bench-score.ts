/**
 * Recette IA — comparaison A/B et scores contre la vérité terrain. Pur et testable.
 * Règle : deux champs vides ne comptent JAMAIS comme un succès (ignorés).
 */
import type { BenchOutput } from "./bench-schema";

export type FlatMap = Record<string, string>;
const SECTIONS = ["document", "totals", "tire", "battery", "workshop"] as const;
const AMOUNT_KEYS = /(price|amount|total|totals\.|discount|vat|ttc|ht|fees|shipping|eco_fee|deposit|gross)/;
const REF_KEYS = /(reference)$/;
const ID_KEYS = /(or_number|plate|vin|order_number|delivery_note_number|invoice_number|credit_note_number|document_number)$/;

export function isEmpty(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
}

/** Normalisation pour comparer : majuscules, sans accents, montants/dates harmonisés. */
export function normValue(path: string, v: unknown): string {
  if (isEmpty(v)) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  let s = String(v).trim();
  const num = s.replace(/\s/g, "").replace(/€|eur/i, "").replace(",", ".");
  if (/^-?\d+(\.\d+)?$/.test(num)) return String(Math.round(Number(num) * 100) / 100);
  const fr = s.match(/^(\d{2})[/.-](\d{2})[/.-](\d{4})$/);
  if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`;
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (REF_KEYS.test(path) || ID_KEYS.test(path)) return s.replace(/[^A-Z0-9]/g, "");
  return s.replace(/\s+/g, " ");
}

function flatSection(prefix: string, o: unknown, out: FlatMap) {
  if (!o || typeof o !== "object") return;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (Array.isArray(v)) v.forEach((item, i) => flatSection(`${prefix}.${k}.${i}`, item, out));
    else if (v && typeof v === "object") flatSection(`${prefix}.${k}`, v, out);
    else if (!isEmpty(v)) out[`${prefix}.${k}`] = String(v);
  }
}

/** Aplatit une sortie (sans confidence/failure_reasons). Lignes indexées après appariement éventuel. */
export function flatten(o: BenchOutput | null | undefined): FlatMap {
  const out: FlatMap = {};
  if (!o) return out;
  if (!isEmpty(o.document_type)) out["document_type"] = String(o.document_type);
  for (const s of SECTIONS) flatSection(s, o[s], out);
  (o.lines ?? []).forEach((l, i) => flatSection(`lines.${i}`, l, out));
  return out;
}

/** Réordonne les lignes de `got` pour suivre `ref` : référence exacte d'abord, puis position. */
export function alignLines(ref: BenchOutput["lines"] = [], got: BenchOutput["lines"] = []): NonNullable<BenchOutput["lines"]> {
  const pool = got.map((l, i) => ({ l, i, used: false }));
  const out: NonNullable<BenchOutput["lines"]> = [];
  ref.forEach((r) => {
    const key = normValue("reference", r?.reference);
    const hit = key ? pool.find((p) => !p.used && normValue("reference", p.l?.reference) === key) : undefined;
    if (hit) { hit.used = true; out.push(hit.l); } else out.push({});
  });
  ref.forEach((_, idx) => {
    if (Object.keys(out[idx] ?? {}).length) return;
    const next = pool.find((p) => !p.used);
    if (next) { next.used = true; out[idx] = next.l; }
  });
  pool.filter((p) => !p.used).forEach((p) => out.push(p.l));
  return out;
}

export type DiffStatus = "identique" | "different" | "absent_a" | "absent_b";
export type DiffRow = { path: string; a: string; b: string; status: DiffStatus };

export function diffOutputs(a: BenchOutput | null | undefined, b: BenchOutput | null | undefined): DiffRow[] {
  const bAligned = b ? { ...b, lines: alignLines(a?.lines, b.lines) } : b;
  const fa = flatten(a);
  const fb = flatten(bAligned);
  const keys = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort(pathSort);
  return keys.map((path) => {
    const av = fa[path] ?? "";
    const bv = fb[path] ?? "";
    const status: DiffStatus = !av ? "absent_a" : !bv ? "absent_b" : normValue(path, av) === normValue(path, bv) ? "identique" : "different";
    return { path, a: av, b: bv, status };
  });
}

function pathSort(x: string, y: string) {
  const rank = (p: string) => (p === "document_type" ? 0 : p.startsWith("document.") ? 1 : p.startsWith("lines.") ? 2 : p.startsWith("totals.") ? 3 : 4);
  return rank(x) - rank(y) || x.localeCompare(y, "fr", { numeric: true });
}

export type Bucket = { correct: number; wrong: number; missing: number; total: number; rate: number | null };
export type BenchScore = {
  global: Bucket;
  lines: Bucket;
  references: Bucket;
  identifiers: Bucket;
  amounts: Bucket;
  details: { path: string; expected: string; got: string; verdict: "correct" | "faux" | "manquant" | "invente" }[];
};

const bucket = (): Bucket => ({ correct: 0, wrong: 0, missing: 0, total: 0, rate: null });

/**
 * Score d'une sortie contre la vérité terrain :
 *  - attendu non vide & égal => correct ; attendu non vide & différent => faux ;
 *  - attendu non vide & obtenu vide => manquant ; attendu vide & obtenu non vide => faux (inventé) ;
 *  - attendu vide & obtenu vide => ignoré.
 */
export function scoreOutput(expected: BenchOutput | null | undefined, got: BenchOutput | null | undefined): BenchScore {
  const aligned = got ? { ...got, lines: alignLines(expected?.lines, got.lines) } : got;
  const fe = flatten(expected);
  const fg = flatten(aligned);
  const s: BenchScore = { global: bucket(), lines: bucket(), references: bucket(), identifiers: bucket(), amounts: bucket(), details: [] };
  const keys = [...new Set([...Object.keys(fe), ...Object.keys(fg)])].sort(pathSort);
  for (const path of keys) {
    const e = fe[path] ?? "";
    const g = fg[path] ?? "";
    if (!e && !g) continue;
    const verdict = !e ? "invente" : !g ? "manquant" : normValue(path, e) === normValue(path, g) ? "correct" : "faux";
    s.details.push({ path, expected: e, got: g, verdict });
    const leaf = path.split(".").pop() ?? path;
    const buckets = [s.global];
    if (path.startsWith("lines.")) buckets.push(s.lines);
    if (REF_KEYS.test(leaf)) buckets.push(s.references);
    if (ID_KEYS.test(leaf)) buckets.push(s.identifiers);
    if (AMOUNT_KEYS.test(path) && !REF_KEYS.test(leaf) && leaf !== "label") buckets.push(s.amounts);
    for (const b of buckets) {
      b.total += 1;
      if (verdict === "correct") b.correct += 1;
      else if (verdict === "manquant") b.missing += 1;
      else b.wrong += 1;
    }
  }
  for (const b of [s.global, s.lines, s.references, s.identifiers, s.amounts]) b.rate = b.total ? Math.round((b.correct / b.total) * 1000) / 10 : null;
  return s;
}

/** Moyenne simple des taux non nuls. */
export function avg(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
}
