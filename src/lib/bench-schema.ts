/**
 * Recette IA documentaire — schéma de sortie unique, types détectables, modèles autorisés et
 * invites versionnées. Module pur (navigateur + serveur) : aucune écriture, aucun secret.
 */
import type { DocKind } from "./doc-rules";

export const BENCH_SCHEMA_VERSION = "bench-schema-v1";
export const BENCH_PROMPT_VERSION = "bench-prompt-v1";
export const BENCH_CLASSIFY_VERSION = "bench-classify-v1";

/** Modèle A = vision actuelle DDA Connect (doit rester aligné sur VISION_MODEL). */
export const MODEL_A = "google/gemini-3.8-flash";

/** V1 : modèles Gemini vision compatibles chat-completions de la passerelle. */
export const BENCH_MODELS = [
  "google/gemini-3.5-flash",
  "google/gemini-3.8-flash",
  "google/gemini-3.7-flash",
  "google/gemini-3.6-flash",
  "google/gemini-3.1-flash-lite",
  "google/gemini-3.1-pro-preview",
  "google/gemini-3-flash-preview",
] as const;

export function isAllowedBenchModel(m: unknown): m is string {
  return typeof m === "string" && (BENCH_MODELS as readonly string[]).includes(m);
}

export const BENCH_KINDS = [
  { key: "delivery_note", label: "BL fournisseur" },
  { key: "purchase_order", label: "Bon de commande fournisseur" },
  { key: "supplier_invoice", label: "Facture fournisseur" },
  { key: "credit_note", label: "Avoir fournisseur" },
  { key: "repair_order", label: "OR / document atelier" },
  { key: "tire", label: "Photo pneu / flanc / étiquette" },
  { key: "battery", label: "Ticket / rapport batterie" },
  { key: "expense_receipt", label: "Ticket de caisse / note de frais" },
  { key: "auto_unknown", label: "Document automobile inconnu" },
  { key: "other", label: "Autre / inconnu" },
] as const;

export type BenchKind = (typeof BENCH_KINDS)[number]["key"];
export const BENCH_KIND_KEYS = BENCH_KINDS.map((k) => k.key) as BenchKind[];
export const kindLabel = (k: string | null | undefined) => BENCH_KINDS.find((x) => x.key === k)?.label ?? "Non déterminé";

/** Type DDA utilisé par le « pipeline réel » (null = pas de pipeline IA en production). */
export function pipelineKind(k: BenchKind): DocKind | null {
  switch (k) {
    case "delivery_note":
    case "purchase_order":
    case "supplier_invoice":
    case "credit_note":
      return "purchase";
    case "repair_order":
      return "repair_order";
    case "battery":
      return "battery";
    case "expense_receipt":
      return "expense";
    case "tire":
      return null; // Production : lecture pneus par OCR local navigateur uniquement, aucun appel IA.
    default:
      return "any_document";
  }
}

export const FAILURE_REASONS = [
  "illisible",
  "champ_absent",
  "ambiguite",
  "timeout",
  "json_invalide",
  "classification_erronee",
  "budget",
  "http_error",
  "reponse_vide",
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

/* --------------------------------- Schéma --------------------------------- */

export const DOCUMENT_FIELDS = [
  "supplier", "client", "address", "phone", "email", "document_number", "delivery_note_number", "order_number",
  "invoice_number", "credit_note_number", "date", "delivery_date", "customer_reference", "supplier_reference",
  "or_number", "file_number", "repere", "plate", "vin", "mileage",
] as const;
export const LINE_FIELDS = [
  "reference", "oem_reference", "supplier_reference", "label", "quantity", "unit", "unit_price_ht", "discount",
  "amount_ht", "vat", "amount_ttc", "deposit", "fees", "shipping", "eco_fee", "comment",
] as const;
export const TOTAL_FIELDS = ["gross", "global_discount", "fees", "ht", "vat", "ttc"] as const;
export const TIRE_FIELDS = [
  "brand", "range", "width", "height", "diameter", "load_index", "speed_index", "homologation", "xl", "runflat",
  "three_pmsf", "mud_snow", "dot", "manufacture_week", "manufacture_year", "other_markings", "wear_pattern",
  "damages", "tread_depth_mm", "tread_depth_note",
] as const;
export const BATTERY_FIELDS = [
  "device_brand", "test_type", "voltage", "technology", "rated_capacity_ah", "cca_rated", "cca_measured", "soc_pct",
  "soh_pct", "internal_resistance", "temperature", "verdict", "tested_at", "plate",
] as const;
export const WORKSHOP_FIELDS = ["or_number", "brand", "model", "version", "requested_work", "observations"] as const;
export const WORK_LINE_FIELDS = ["label", "hours", "amount"] as const;

export type Scalar = string | number | boolean | null;
export type BenchLine = Partial<Record<(typeof LINE_FIELDS)[number], Scalar>>;
export type BenchOutput = {
  document_type?: string | null;
  document?: Partial<Record<(typeof DOCUMENT_FIELDS)[number], Scalar>>;
  lines?: BenchLine[];
  totals?: Partial<Record<(typeof TOTAL_FIELDS)[number], Scalar>>;
  tire?: Partial<Record<(typeof TIRE_FIELDS)[number], Scalar>>;
  battery?: Partial<Record<(typeof BATTERY_FIELDS)[number], Scalar>>;
  workshop?: Partial<Record<(typeof WORKSHOP_FIELDS)[number], Scalar>> & { work_lines?: Partial<Record<(typeof WORK_LINE_FIELDS)[number], Scalar>>[] };
  confidence?: Record<string, number>;
  failure_reasons?: { field: string; reason: string }[];
};

export const TREAD_DEPTH_NOTE = "profondeur non mesurable avec fiabilité sur cette photo";

const nulls = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, null]));

/** Gabarit JSON vide envoyé tel quel aux deux modèles. */
export function emptyBenchOutput(): Required<Omit<BenchOutput, "confidence" | "failure_reasons">> & Pick<BenchOutput, "confidence" | "failure_reasons"> {
  return {
    document_type: null,
    document: nulls(DOCUMENT_FIELDS),
    lines: [nulls(LINE_FIELDS)],
    totals: nulls(TOTAL_FIELDS),
    tire: nulls(TIRE_FIELDS),
    battery: nulls(BATTERY_FIELDS),
    workshop: { ...nulls(WORKSHOP_FIELDS), work_lines: [nulls(WORK_LINE_FIELDS)] },
    confidence: { "document.plate": 0.9 },
    failure_reasons: [{ field: "document.vin", reason: "champ_absent" }],
  };
}

/** Invite d'extraction, identique pour A et B (seul le type indiqué varie avec le document). */
export function extractionPrompt(kind: BenchKind): string {
  return `Tu es un moteur d'extraction de documents d'atelier automobile français (version ${BENCH_PROMPT_VERSION}).
Type de document indiqué : ${kind} (${kindLabel(kind)}). Si le contenu contredit ce type, mets le vrai type dans document_type.
Lis TOUTES les pages / photos fournies (elles décrivent le même objet). Extrais uniquement ce qui est réellement lisible.
Réponds STRICTEMENT par un seul objet JSON compact, sans texte autour, avec exactement cette forme (gabarit) :
${JSON.stringify(emptyBenchOutput())}
Règles :
- document_type parmi : ${BENCH_KIND_KEYS.join(", ")}.
- Valeur absente ou illisible = null. N'invente RIEN. Aucune limite de nombre de lignes : une entrée "lines" par ligne article (frais de port, consigne, éco-participation inclus). Pas de ligne si aucune.
- Nombres : point décimal, sans symbole ni unité. Dates : ISO YYYY-MM-DD (ou YYYY-MM-DDTHH:mm). Immatriculation au format AB-123-CD.
- Pneus : dimension séparée (205/55 R16 91V => width 205, height 55, diameter 16, load_index 91, speed_index "V"). xl/runflat/three_pmsf/mud_snow = true/false/null.
  Usure : décris seulement (régulière, intérieure, extérieure, centrale, craquelures, déformation, témoin proche/atteint).
  tread_depth_mm = null SAUF si une jauge ou une mesure chiffrée est lisible ; sinon tread_depth_note = "${TREAD_DEPTH_NOTE}".
- Batterie : valeurs du ticket uniquement (verdict tel qu'imprimé).
- OR : en-tête du garage émetteur et « votre conseiller » ne sont jamais le client.
- confidence : objet {"chemin.du.champ": 0..1} pour chaque champ renseigné (ex "document.plate", "lines.0.reference").
- failure_reasons : [{"field":"chemin","reason":"${FAILURE_REASONS.join("|")}"}] pour les champs attendus mais non lus.
- Supprime du gabarit les sections inutiles au type (ex : tire pour une facture) ou laisse-les à null.`;
}

export function classifyPrompt(): string {
  return `Classe ce document d'atelier automobile (version ${BENCH_CLASSIFY_VERSION}).
Réponds STRICTEMENT en JSON compact : {"kind":null,"confidence":0}
kind parmi : ${BENCH_KIND_KEYS.join(", ")}. confidence entre 0 et 1. Aucun autre texte.`;
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Lecture tolérante d'une réponse JSON de modèle. */
export function parseModelJson(content: string): BenchOutput | null {
  const cleaned = content.replace(/```json/gi, "").replace(/```/g, "").trim();
  const s = cleaned.indexOf("{");
  const e = cleaned.lastIndexOf("}");
  if (s < 0 || e < s) return null;
  try {
    const v = JSON.parse(cleaned.slice(s, e + 1)) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as BenchOutput) : null;
  } catch {
    return null;
  }
}

/** Garde-fou métier : profondeur de sculpture jamais inventée sans mesure lisible. */
export function enforceTireDepthRule(out: BenchOutput): BenchOutput {
  const t = out.tire;
  if (!t) return out;
  const conf = out.confidence?.["tire.tread_depth_mm"];
  if (t.tread_depth_mm != null && (conf == null || conf < 0.8)) {
    return { ...out, tire: { ...t, tread_depth_mm: null, tread_depth_note: TREAD_DEPTH_NOTE } };
  }
  return out;
}
