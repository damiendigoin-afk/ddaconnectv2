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
