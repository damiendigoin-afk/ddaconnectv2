/** Exercice comptable DDA : avril → mars (ex. 04/2026 → 03/2027). */

function parse(periodStart: string): { y: number; m: number } {
  const d = new Date(`${periodStart}T00:00:00`);
  return { y: d.getFullYear(), m: d.getMonth() };
}

function iso(y: number, m0: number): string {
  return `${y}-${String(m0 + 1).padStart(2, "0")}-01`;
}

/** 1er avril de l'exercice contenant le mois donné. */
export function fiscalYearStart(periodStart: string): string {
  const { y, m } = parse(periodStart);
  return m >= 3 ? iso(y, 3) : iso(y - 1, 3);
}

/** Mars (dernier mois) de l'exercice contenant le mois donné. */
export function fiscalYearEnd(periodStart: string): string {
  const start = fiscalYearStart(periodStart);
  const { y } = parse(start);
  return iso(y + 1, 2);
}

export function fiscalYearRange(periodStart: string): { start: string; end: string } {
  return { start: fiscalYearStart(periodStart), end: fiscalYearEnd(periodStart) };
}

/** Libellé « Exercice 04/2026 → 03/2027 ». */
export function fiscalYearLabel(periodStart: string): string {
  const { start, end } = fiscalYearRange(periodStart);
  return `Exercice ${start.slice(5, 7)}/${start.slice(0, 4)} → ${end.slice(5, 7)}/${end.slice(0, 4)}`;
}

/** Exercice en cours à la date de référence. */
export function currentFiscalYear(reference = new Date()): { start: string; end: string; label: string } {
  const key = iso(reference.getFullYear(), reference.getMonth());
  const range = fiscalYearRange(key);
  return { ...range, label: fiscalYearLabel(key) };
}
