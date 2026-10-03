import type { TireStepResult } from "./tire-step";
import { TIRE_STEP_PROMPT, normalizeTireStep, quoteSearchFromResult, wearLevel } from "./tire-step";

export const TOUR_TIRE_KEYS = ["pneu_avg", "pneu_avd", "pneu_arg", "pneu_ard"] as const;
export type TourTireKey = (typeof TOUR_TIRE_KEYS)[number];

export type TourTireStored = {
  source: "tour_global_ai";
  model: string;
  result: TireStepResult;
  corrected: TireStepResult;
  confirmed: boolean;
  analyzedAt: string;
  photoCount: number;
  mainPhotoPath: string | null;
  confirmedRef: string | null;
};

export function tireNeedsReplacement(result: TireStepResult): boolean {
  const depths = [result.depth.inner_mm, result.depth.center_mm, result.depth.outer_mm];
  const criticalDepth = depths.some((v) => wearLevel(v) === "critique");
  const criticalText = [result.wear.recommendation, ...result.wear.observations].join(" ");
  return criticalDepth || result.wear.wear_indicator === "atteint" || /lisse|carcasse|corde\s+visible|toile\s+visible/i.test(criticalText);
}

export type TourTireRecommendation = { quantity: 0 | 2 | 4; axles: ("avant" | "arriere")[]; label: string };

/** Cohérence atelier : paire par essieu ; un besoin sur chaque essieu => quatre pneus. */
export function replacementRecommendation(rows: Partial<Record<TourTireKey, TireStepResult>>): TourTireRecommendation {
  const front = [rows.pneu_avg, rows.pneu_avd].some((r) => r && tireNeedsReplacement(r));
  const rear = [rows.pneu_arg, rows.pneu_ard].some((r) => r && tireNeedsReplacement(r));
  if (front && rear) return { quantity: 4, axles: ["avant", "arriere"], label: "Remplacement cohérent des 4 pneus" };
  if (front) return { quantity: 2, axles: ["avant"], label: "Remplacement par paire sur l’essieu avant" };
  if (rear) return { quantity: 2, axles: ["arriere"], label: "Remplacement par paire sur l’essieu arrière" };
  return { quantity: 0, axles: [], label: "Aucun remplacement par essieu recommandé" };
}

export function estimatedAnalysisProgress(elapsedMs: number): number {
  if (elapsedMs <= 0) return 4;
  return Math.min(95, Math.round(4 + 91 * (1 - Math.exp(-elapsedMs / 7_000))));
}

export function legacyTireAnalysis(result: TireStepResult) {
  const depths = [result.depth.inner_mm, result.depth.center_mm, result.depth.outer_mm].filter((v): v is number => v !== null);
  const depth = depths.length ? Math.min(...depths) : null;
  const urgent = tireNeedsReplacement(result);
  const grade = urgent ? "imperatif" : depth !== null && depth < 3 ? "rapide" : depth !== null && depth <= 4 ? "a_prevoir" : "correct";
  const ai = {
    brand: result.sidewall.brand, model: result.sidewall.model, size: result.sidewall.size,
    load_index: result.sidewall.load_index, speed_index: result.sidewall.speed_index,
    season: null, dot: result.sidewall.dot, depth_mm: depth, depth_kind: "estimation",
    wear: result.wear.pattern, wear_zone: result.wear.stronger_zone,
    cracks: result.wear.cracks, cuts: false, bulges: /hernie|d[ée]formation/i.test(result.wear.observations.join(" ")),
    foreign_objects: false, sidewall_damage: /flanc|carcasse|corde/i.test(result.wear.observations.join(" ")),
    rim_damage: false, photo_quality: result.depth.confidence === "faible" ? "moyenne" : "bonne",
    confidence: { depth_mm: result.depth.confidence, size: result.sidewall.read_quality }, observations: result.wear.observations,
    client_comment: result.wear.recommendation, unreadable: [], model_used: "google/gemini-3.1-pro-preview",
  };
  return { ai, final: ai, grade, reasons: result.wear.observations, confirmed: true, partial: false, attempts: 1, confirmedRef: result.sidewall.size, tourStep: result, quote: quoteSearchFromResult(result) };
}
/* ---------------- Analyse IA groupée des 4 roues (même moteur qu'État pneus) ---------------- */

/** Change à chaque évolution du prompt : invalide les anciennes réponses mises en cache. */
export const TOUR_TIRES_PROMPT_VERSION = "tour-tires-v2";

export const TOUR_ROLE_LABEL = { bande: "Photo bande de roulement", flanc: "Photo du flanc", dimension: "Photo de la dimension (flanc, marquages)" } as const;

/** Prompt groupé : reprend mot pour mot les consignes et le schéma JSON d'État pneus, appliqués à chaque roue. */
export function tourTiresPrompt(batteryContext: unknown): string {
  return `Tu vas analyser les QUATRE pneus d'un même véhicule en UNE réponse. Pour CHAQUE roue, applique exactement les consignes État pneus ci-dessous (écrites pour un pneu) aux photos de cette roue, dont la clé (ROUE PNEU_AVG, etc.) et le rôle sont indiqués avant chaque image.

=== CONSIGNES ÉTAT PNEUS (PAR ROUE) ===
${TIRE_STEP_PROMPT}
=== FIN CONSIGNES ===

Les défauts critiques (lisse, témoin atteint, carcasse ou corde visible) priment. Le test batterie suivant est un simple contexte, il ne modifie jamais les pneus : ${JSON.stringify(batteryContext ?? null)}.
RÉPONSE FINALE STRICTEMENT EN JSON : {"wheels":{"pneu_avg":OBJET,"pneu_avd":OBJET,"pneu_arg":OBJET,"pneu_ard":OBJET}} où chaque OBJET est l'objet complet {"sidewall":{...},"wear":{...},"depth":{...}} décrit ci-dessus, avec les mêmes clés (inner_mm, center_mm, outer_mm, pattern, wear_indicator...). Aucune autre forme.`;
}

/** Tolère une profondeur renvoyée sous forme de tableau [gauche, milieu, droite] (valeurs réelles de l'IA, jamais inventées). */
function coerceWheel(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = { ...(raw as Record<string, unknown>) };
  if (Array.isArray(r["depth"])) {
    const [a, b, c] = r["depth"] as unknown[];
    r["depth"] = { inner_mm: a ?? null, center_mm: b ?? null, outer_mm: c ?? null };
  }
  for (const k of ["sidewall", "wear", "depth"]) if (typeof r[k] !== "object" || r[k] === null) r[k] = {};
  return r;
}

/** Une roue est exploitable si l'IA a donné au moins une profondeur, un type d'usure, un témoin ou une dimension. */
export function wheelAnalysed(r: TireStepResult): boolean {
  return [r.depth.inner_mm, r.depth.center_mm, r.depth.outer_mm].some((v) => v !== null) ||
    r.wear.pattern !== null || r.wear.wear_indicator !== null || r.sidewall.size !== null;
}

export type TourTiresParse =
  | { ok: true; results: Record<TourTireKey, TireStepResult> }
  | { ok: false; error: string };

/** Lecture stricte : une réponse vide ou hors schéma est une ERREUR, jamais une synthèse « non déterminée ». */
export function parseTourTiresResponse(raw: unknown): TourTiresParse {
  const wheels = (raw as { wheels?: Record<string, unknown> } | null)?.wheels;
  if (!wheels || typeof wheels !== "object") return { ok: false, error: "Réponse IA illisible — relancez l’analyse sans reprendre les photos." };
  const results = {} as Record<TourTireKey, TireStepResult>;
  const empty: TourTireKey[] = [];
  for (const key of TOUR_TIRE_KEYS) {
    const r = normalizeTireStep(coerceWheel(wheels[key]));
    results[key] = r;
    if (!wheelAnalysed(r)) empty.push(key);
  }
  if (empty.length) return { ok: false, error: `Analyse IA inexploitable pour : ${empty.map((k) => k.replace("pneu_", "").toUpperCase()).join(", ")}. Relancez l’analyse.` };
  return { ok: true, results };
}
