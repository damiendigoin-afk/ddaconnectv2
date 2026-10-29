/**
 * Contrôle technique : une seule date structurée (inspection_points.ct_due_date /
 * vehicles.ct_due_date) sert partout — commentaire du point, en-tête du compte
 * rendu écran, aperçu client et PDF.
 */

export const CT_PREFIX = "Contrôle technique valable jusqu'au";
export const POLLUTION_PREFIX = "Contrôle complémentaire pollution à effectuer avant le";
export const CT_MISSING = "Date du contrôle technique non renseignée.";

/** ISO (YYYY-MM-DD ou datetime) → JJ/MM/AAAA. Chaîne vide si non exploitable. */
export function formatCtDate(value?: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR");
}

/** Bloc automatique injecté dans le commentaire du point « Contrôle technique ». */
export function ctAutoComment(ct?: string | null, pollution?: string | null): string {
  const lines: string[] = [];
  const ctDate = formatCtDate(ct);
  const pollutionDate = formatCtDate(pollution);
  if (ctDate) lines.push(`${CT_PREFIX} ${ctDate}.`);
  else lines.push(CT_MISSING);
  if (pollutionDate) lines.push(`${POLLUTION_PREFIX} ${pollutionDate}.`);
  return lines.join("\n");
}

const AUTO_LINE = new RegExp(
  `^\\s*(${escape(CT_PREFIX)}|${escape(POLLUTION_PREFIX)}|${escape(CT_MISSING)})`,
  "i",
);

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Met à jour la partie automatique du commentaire sans doublon,
 * en conservant intégralement le commentaire saisi par l'opérateur.
 */
export function mergeCtComment(
  existing: string | null | undefined,
  ct?: string | null,
  pollution?: string | null,
): string {
  const manual = (existing ?? "")
    .split("\n")
    .filter((line) => !AUTO_LINE.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const auto = ctAutoComment(ct, pollution);
  return manual ? `${manual}\n${auto}` : auto;
}

/** Libellé court affiché à côté du kilométrage. */
export function ctSummaryLabel(ct?: string | null): string {
  const date = formatCtDate(ct);
  return date ? `CT valable jusqu'au ${date}` : CT_MISSING;
}

/** Kilométrage + CT sur une seule ligne : « 193 812 km · CT valable jusqu'au 15/04/2027 ». */
export function mileageAndCtLine(mileage: number | null | undefined, ct?: string | null): string {
  const km = mileage != null ? `${mileage.toLocaleString("fr-FR")} km` : "Kilométrage non relevé";
  return `${km} · ${ctSummaryLabel(ct)}`;
}

/** Première date exploitable (non vide, convertible) parmi les candidates, sinon null. */
export function firstValidCtDate(...values: (string | null | undefined)[]): string | null {
  for (const v of values) {
    if (formatCtDate(v)) return (v as string).trim();
  }
  return null;
}

/**
 * Date CT retenue pour un rapport : point de contrôle en priorité, puis véhicule.
 * Une valeur vide ou invalide sur le point ne masque jamais la date du véhicule.
 */
export function reportCtDates(d: {
  vehicle?: { ct_due_date?: string | null; pollution_due_date?: string | null } | null;
  points?: { point_key?: string | null; ct_due_date?: string | null; pollution_due_date?: string | null }[];
}): { ct: string | null; pollution: string | null } {
  const point = (d.points ?? []).find((p) => p.point_key === "controle_technique");
  return {
    ct: firstValidCtDate(point?.ct_due_date, d.vehicle?.ct_due_date),
    pollution: firstValidCtDate(point?.pollution_due_date, d.vehicle?.pollution_due_date),
  };
}

/** Mention affichée sur la ligne « Contrôle technique » du rapport, quel que soit l'état. */
export function ctPointLine(ct?: string | null, pollution?: string | null): string {
  const date = formatCtDate(ct);
  const pol = formatCtDate(pollution);
  return [date ? `CT valable jusqu'au ${date}` : CT_MISSING, pol ? `${POLLUTION_PREFIX} ${pol}.` : ""]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Patchs d'enregistrement CT. Une lecture OCR sans date ne doit jamais effacer
 * une date déjà connue : les champs vides sont alors omis. Une saisie manuelle
 * vide reste une décision explicite et efface la date.
 */
export function ctPersistValues(ct: string, pollution: string, manual: boolean): {
  ct_due_date?: string | null;
  pollution_due_date?: string | null;
} {
  const out: { ct_due_date?: string | null; pollution_due_date?: string | null } = {};
  const c = firstValidCtDate(ct);
  const p = firstValidCtDate(pollution);
  if (c || manual) out.ct_due_date = c;
  if (p || manual) out.pollution_due_date = p;
  return out;
}

/** Commentaire opérateur sans les lignes CT automatiques (évite le doublon/contradiction). */
export function stripCtAuto(comment?: string | null): string {
  return (comment ?? "").split("\n").filter((l) => !AUTO_LINE.test(l)).join("\n").trim();
}
