import type { TireStepResult } from "./tire-step";
import { wearLevel } from "./tire-step";

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