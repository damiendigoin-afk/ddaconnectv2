/** Recette IA — types partagés, export JSON / texte lisible et anonymisation. Pur. */
import { kindLabel, type BenchOutput } from "./bench-schema";
import { diffOutputs, scoreOutput, type BenchScore } from "./bench-score";

export type BenchVariant = "A" | "B" | "pipeline";

export type BenchRun = {
  variant: BenchVariant;
  model: string;
  promptVersion: string;
  promptHash: string;
  promptText: string;
  schemaVersion: string;
  docKind: string;
  startedAt: string;
  mediaMs: number;
  aiMs: number;
  parseMs: number;
  serverMs: number;
  totalMs: number | null;
  tokensIn: number;
  tokensOut: number;
  credits: number;
  httpStatus: number | null;
  success: boolean;
  cacheHit: boolean;
  failureReason: string | null;
  route: string | null;
  aiCalls: number;
  parsed: BenchOutput | null;
  rawText: string;
};

export type BenchTestExport = {
  export_version: "bench-export-v1";
  file_name: string;
  sha256: string;
  storage_paths: string[];
  page_count: number | null;
  photo_count: number;
  tested_at: string;
  detected_kind: string | null;
  detected_kind_label: string;
  kind_confidence: number | null;
  kind_source: string | null;
  corrected_kind: string | null;
  app_version: string | null;
  timings_client: Record<string, number | null>;
  runs: (BenchRun & { score: BenchScore | null })[];
  diff_a_b: ReturnType<typeof diffOutputs>;
  expected: BenchOutput | null;
  anonymized: boolean;
};

export type BenchTestInput = Omit<BenchTestExport, "export_version" | "runs" | "diff_a_b" | "anonymized" | "detected_kind_label"> & { runs: BenchRun[] };

/* ------------------------------ Anonymisation ------------------------------ */

const PERSONAL = /(^|\.)(client|address|phone|email|customer_reference)$/;

export function maskValue(path: string, v: string): string {
  const leaf = path.split(".").pop() ?? "";
  if (leaf === "vin") return v.length > 4 ? `${"*".repeat(v.length - 4)}${v.slice(-4)}` : "****";
  if (leaf === "plate") return v.replace(/[A-Z0-9]/gi, (c, i: number) => (i < 2 ? c : "*"));
  if (PERSONAL.test(path)) return "[anonymisé]";
  return v;
}

function maskObj(prefix: string, o: unknown): unknown {
  if (Array.isArray(o)) return o.map((x, i) => maskObj(`${prefix}.${i}`, x));
  if (o && typeof o === "object") return Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, v]) => [k, maskObj(prefix ? `${prefix}.${k}` : k, v)]));
  if (typeof o === "string") return maskValue(prefix.replace(/\.\d+(?=\.)/g, ""), o);
  return o;
}

export function anonymizeOutput(o: BenchOutput | null): BenchOutput | null {
  return o ? (maskObj("", o) as BenchOutput) : null;
}

/** Masque e-mails, téléphones et VIN éventuels dans une réponse brute. */
export function anonymizeRaw(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}/g, "[téléphone]")
    .replace(/\b[A-HJ-NPR-Z0-9]{13}(\d{4})\b/g, "*************$1");
}

/* --------------------------------- Export --------------------------------- */

export function buildTestExport(t: BenchTestInput, anonymize = false): BenchTestExport {
  const a = t.runs.find((r) => r.variant === "A")?.parsed ?? null;
  const b = t.runs.find((r) => r.variant === "B")?.parsed ?? null;
  const mask = (o: BenchOutput | null) => (anonymize ? anonymizeOutput(o) : o);
  const runs = t.runs.map((r) => ({
    ...r,
    parsed: mask(r.parsed),
    rawText: anonymize ? anonymizeRaw(r.rawText) : r.rawText,
    score: t.expected ? scoreOutput(t.expected, r.parsed) : null,
  }));
  return {
    export_version: "bench-export-v1",
    ...t,
    file_name: anonymize ? `document-${t.sha256.slice(0, 8)}` : t.file_name,
    detected_kind_label: kindLabel(t.corrected_kind ?? t.detected_kind),
    runs,
    diff_a_b: diffOutputs(mask(a), mask(b)),
    expected: mask(t.expected),
    anonymized: anonymize,
  };
}

const pct = (n: number | null | undefined) => (n == null ? "—" : `${n} %`);

export function testToText(e: BenchTestExport): string {
  const L: string[] = [];
  L.push(`RECETTE IA — ${e.file_name} (${e.tested_at})`);
  L.push(`Type : ${e.detected_kind_label}${e.corrected_kind ? " (corrigé)" : ""} — confiance ${e.kind_confidence ?? "—"} (${e.kind_source ?? "—"})`);
  L.push(`Média : ${e.photo_count} fichier(s), ${e.page_count ?? "?"} page(s), SHA-256 ${e.sha256.slice(0, 16)}…`);
  for (const r of e.runs) {
    L.push("");
    L.push(`== ${r.variant === "pipeline" ? "Pipeline réel DDA" : `Modèle ${r.variant}`} : ${r.model} (${r.promptVersion}, hash ${r.promptHash.slice(0, 10)})`);
    L.push(`Succès : ${r.success ? "oui" : "non"}${r.failureReason ? ` — motif : ${r.failureReason}` : ""}${r.route ? ` — voie : ${r.route}` : ""}`);
    L.push(`Temps : IA ${r.aiMs} ms, parsing ${r.parseMs} ms, serveur ${r.serverMs} ms, total ${r.totalMs ?? "—"} ms`);
    L.push(`Tokens : ${r.tokensIn} in / ${r.tokensOut} out — ${r.credits} crédits — HTTP ${r.httpStatus ?? "—"} — cache ${r.cacheHit ? "oui" : "non"}`);
    if (r.score) L.push(`Score : global ${pct(r.score.global.rate)}, lignes ${pct(r.score.lines.rate)}, références ${pct(r.score.references.rate)}, OR/immat ${pct(r.score.identifiers.rate)}, montants ${pct(r.score.amounts.rate)}`);
  }
  const diffs = e.diff_a_b.filter((d) => d.status !== "identique");
  L.push("");
  L.push(`Différences A/B : ${diffs.length}`);
  for (const d of diffs.slice(0, 200)) L.push(`- ${d.path} : A="${d.a}" | B="${d.b}" (${d.status})`);
  return L.join("\n");
}

export type CampaignSummaryRow = { kind: string; count: number; a: number | null; b: number | null; pipeline: number | null };
