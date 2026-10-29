/**
 * Correction manuelle de l'« Analyse des 4 pneus » (notamment après clôture du tour).
 * Règles pures : préchargement depuis les points enregistrés, statut choisi par
 * l'opérateur, motif obligatoire, historique avant/après (auteur, date) conservé.
 * Une mesure n'est jamais inventée : seules les profondeurs saisies changent.
 */
import { legacyTireAnalysis, TOUR_TIRE_KEYS, type TourTireKey } from "./tour-tire-analysis";
import { normalizeTireStep, type TireStepResult } from "./tire-step";

export type TireStatus = "ok" | "watch" | "defect";
export const TIRE_STATUS_LABEL: Record<TireStatus, string> = { ok: "OK", watch: "À surveiller", defect: "À remplacer" };

type Depths = { inner_mm: number | null; center_mm: number | null; outer_mm: number | null };

export type TireCorrectionEntry = {
  at: string;
  byId: string | null;
  byName: string | null;
  afterClosure: boolean;
  reason: string;
  previous: { status: string; depths: Depths };
  next: { status: TireStatus; depths: Depths };
};

export type TirePointLike = { id: string; point_key: string; status: string; tire_analysis?: unknown };

export type TireEditState = { result: TireStepResult | null; status: TireStatus; reason: string };

/** Statut automatique déduit d'un résultat (même règle que l'enregistrement de fin de tour). */
export function autoStatusFromResult(result: TireStepResult): TireStatus {
  return legacyTireAnalysis(result).grade === "correct" ? "ok" : "defect";
}

function asStatus(s: string): TireStatus {
  return s === "watch" || s === "defect" ? s : "ok";
}

function depthsOf(r: TireStepResult | null): Depths {
  return { inner_mm: r?.depth.inner_mm ?? null, center_mm: r?.depth.center_mm ?? null, outer_mm: r?.depth.outer_mm ?? null };
}

/** Préchargement : résultats et statuts DÉJÀ enregistrés, sans aucun appel IA. */
export function preloadTireEdit(points: TirePointLike[]): Partial<Record<TourTireKey, TireEditState>> {
  const out: Partial<Record<TourTireKey, TireEditState>> = {};
  for (const key of TOUR_TIRE_KEYS) {
    const p = points.find((x) => x.point_key === key);
    if (!p) continue;
    const step = (p.tire_analysis as { tourStep?: Record<string, unknown> } | null)?.tourStep;
    out[key] = { result: step ? normalizeTireStep(step) : null, status: asStatus(p.status), reason: "" };
  }
  return out;
}

export function tireEditChanged(point: TirePointLike, next: TireEditState): boolean {
  const before = preloadTireEdit([point])[point.point_key as TourTireKey];
  if (!before) return false;
  if (before.status !== next.status || point.status !== next.status) return true;
  const a = depthsOf(before.result), b = depthsOf(next.result);
  return a.inner_mm !== b.inner_mm || a.center_mm !== b.center_mm || a.outer_mm !== b.outer_mm || (!before.result && !!next.result);
}

export type TireCorrectionUpdate = {
  pointId: string;
  patch: { status: TireStatus; tire_analysis: Record<string, unknown>; measure_value?: string | null; measure_unit?: string };
  entry: TireCorrectionEntry;
};

/**
 * Construit les mises à jour des roues modifiées. Toute roue modifiée exige un motif.
 * Retourne les erreurs (roues sans motif) sans rien construire dans ce cas.
 */
export function buildTireCorrections(input: {
  points: TirePointLike[];
  edits: Partial<Record<TourTireKey, TireEditState>>;
  actor: { id: string | null; name: string | null };
  afterClosure: boolean;
  now?: Date;
}): { ok: true; updates: TireCorrectionUpdate[] } | { ok: false; missingReason: TourTireKey[] } {
  const at = (input.now ?? new Date()).toISOString();
  const updates: TireCorrectionUpdate[] = [];
  const missingReason: TourTireKey[] = [];
  for (const key of TOUR_TIRE_KEYS) {
    const point = input.points.find((p) => p.point_key === key);
    const edit = input.edits[key];
    if (!point || !edit || !tireEditChanged(point, edit)) continue;
    const reason = edit.reason.trim();
    if (!reason) { missingReason.push(key); continue; }
    const prevTa = (point.tire_analysis ?? {}) as Record<string, unknown>;
    const prevStep = prevTa["tourStep"] ? normalizeTireStep(prevTa["tourStep"] as Record<string, unknown>) : null;
    const entry: TireCorrectionEntry = {
      at, byId: input.actor.id, byName: input.actor.name, afterClosure: input.afterClosure, reason,
      previous: { status: point.status, depths: depthsOf(prevStep) },
      next: { status: edit.status, depths: depthsOf(edit.result) },
    };
    const history = Array.isArray(prevTa["corrections"]) ? (prevTa["corrections"] as TireCorrectionEntry[]) : [];
    const base = edit.result ? legacyTireAnalysis(edit.result) : {};
    const tire_analysis = { ...prevTa, ...base, manualStatus: edit.status, manualReason: reason, correctedAt: at, corrections: [...history, entry] };
    const patch: TireCorrectionUpdate["patch"] = { status: edit.status, tire_analysis };
    if (edit.result) {
      const depth = (base as ReturnType<typeof legacyTireAnalysis>).ai.depth_mm;
      patch.measure_value = depth === null ? null : String(depth);
      patch.measure_unit = "mm";
    }
    updates.push({ pointId: point.id, patch, entry });
  }
  return missingReason.length ? { ok: false, missingReason } : { ok: true, updates };
}
