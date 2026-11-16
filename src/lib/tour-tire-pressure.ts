import { TOUR_TIRE_KEYS } from "./tour-tire-analysis";

export const TIRE_PRESSURE_LABEL = "Pression contrôlée et ajustée selon les préconisations constructeur";

export type TirePressurePoint = {
  id: string;
  point_key?: string | null;
  point_label: string;
  tire_analysis?: unknown;
};

function analysisRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Les anciens tours sans clé et toute valeur non booléenne restent non confirmés. */
export function isTirePressureChecked(value: unknown): boolean {
  return analysisRecord(value)["pressure_checked"] === true;
}

/** Ajoute la seule confirmation de pression, sans altérer l'analyse ni les références existantes. */
export function withTirePressureChecked(value: unknown, checked: boolean): Record<string, unknown> {
  return { ...analysisRecord(value), pressure_checked: checked };
}

/**
 * Fusionne une nouvelle analyse avec le JSON fraîchement relu. La confirmation
 * enregistrée sur la roue est prioritaire et n'est jamais reprise d'une autre roue.
 */
export function mergeTourTireAnalysis(current: unknown, next: unknown): Record<string, unknown> {
  const before = analysisRecord(current);
  const merged = { ...before, ...analysisRecord(next) };
  if (typeof before["pressure_checked"] === "boolean") {
    merged["pressure_checked"] = before["pressure_checked"];
  }
  return merged;
}

export function tirePressureReportLabel(value: unknown): "Pression vérifiée : Oui" | "Pression vérifiée : Non confirmée" {
  return isTirePressureChecked(value) ? "Pression vérifiée : Oui" : "Pression vérifiée : Non confirmée";
}

/** Toujours dans l'ordre AVG, AVD, ARG, ARD ; aucune ligne n'est créée pour un autre contrôle. */
export function tourTirePressureRows(points: TirePressurePoint[]) {
  return TOUR_TIRE_KEYS.flatMap((key) => {
    const point = points.find((p) => p.point_key === key);
    return point
      ? [{ id: point.id, key, label: point.point_label, status: tirePressureReportLabel(point.tire_analysis) }]
      : [];
  });
}
