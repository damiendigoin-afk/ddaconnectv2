/**
 * Normalisation des dates saisies : indépendante du format régional du
 * téléphone. On n'exploite jamais le texte affiché (JJ/MM/AAAA, DD.MM.YYYY…),
 * uniquement la valeur native des champs `date` / `datetime-local`.
 */

/** Valeur `<input type="date">` → `YYYY-MM-DD` (ou null). */
export function isoDate(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // Secours : format régional saisi manuellement (JJ/MM/AAAA ou JJ.MM.AAAA).
  const f = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (f) return `${f[3]}-${f[2]!.padStart(2, "0")}-${f[1]!.padStart(2, "0")}`;
  return null;
}

/** Valeur `<input type="datetime-local">` → timestamp ISO UTC (ou null). */
export function isoTimestamp(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(v);
  if (m) {
    const d = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
    );
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const day = isoDate(v);
  if (day) return new Date(`${day}T00:00:00`).toISOString();
  return null;
}
