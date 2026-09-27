/**
 * Normalisation centrale des mesures (profondeur pneu, pression, km…).
 * Une valeur non finie (NaN, Infinity), vide ou non numérique alors qu'une
 * mesure numérique est attendue n'est jamais une mesure valide : elle vaut null.
 */
const NUMERIC_UNITS = new Set(["mm", "km", "bar", "v", "%", "cca", "a", "°c", "psi", "ah"]);
const NON_FINITE = /^[-+]?(nan|inf|infinity)$/i;

export function isNumericUnit(unit: string | null | undefined): boolean {
  return !!unit && NUMERIC_UNITS.has(unit.trim().toLowerCase());
}

export function normalizeMeasureValue(
  value: unknown,
  unit?: string | null,
): string | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || NON_FINITE.test(v)) return null;
  if (isNumericUnit(unit)) {
    const n = Number(v.replace(",", "."));
    if (!Number.isFinite(n)) return null;
  }
  return v;
}

/** Nombre fini ou null (saisie numérique). */
export function finiteOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Texte affichable « 4 mm » ou null si la mesure est invalide. */
export function formatMeasure(value: unknown, unit?: string | null): string | null {
  const v = normalizeMeasureValue(value, unit);
  if (v == null) return null;
  return `${v} ${unit ?? ""}`.trim();
}
