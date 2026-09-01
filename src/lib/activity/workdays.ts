/** Jours ouvrés France (lundi-vendredi hors jours fériés), calcul local sans dépendance. */

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Jours fériés légaux français (métropole) d'une année, au format ISO. */
export function frenchHolidays(year: number): Set<string> {
  const easter = easterSunday(year);
  return new Set([
    iso(new Date(year, 0, 1)),
    iso(addDays(easter, 1)), // lundi de Pâques
    iso(new Date(year, 4, 1)),
    iso(new Date(year, 4, 8)),
    iso(addDays(easter, 39)), // Ascension
    iso(addDays(easter, 50)), // lundi de Pentecôte
    iso(new Date(year, 6, 14)),
    iso(new Date(year, 7, 15)),
    iso(new Date(year, 10, 1)),
    iso(new Date(year, 10, 11)),
    iso(new Date(year, 11, 25)),
  ]);
}

export function isWorkday(d: Date, holidays = frenchHolidays(d.getFullYear())): boolean {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  return !holidays.has(iso(d));
}

export type MonthProgress = {
  total: number;
  elapsed: number;
  remaining: number;
  ratio: number | null;
};

/**
 * Avancement d'un mois : jours ouvrés totaux, écoulés à la date de référence, restants.
 * `periodStart` au format YYYY-MM-01.
 */
export function monthProgress(periodStart: string, reference = new Date()): MonthProgress {
  const start = new Date(`${periodStart}T00:00:00`);
  const year = start.getFullYear();
  const month = start.getMonth();
  const holidays = frenchHolidays(year);
  const last = new Date(year, month + 1, 0).getDate();
  const ref = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  let total = 0;
  let elapsed = 0;
  for (let day = 1; day <= last; day++) {
    const d = new Date(year, month, day);
    if (!isWorkday(d, holidays)) continue;
    total++;
    if (d <= ref) elapsed++;
  }
  return { total, elapsed, remaining: Math.max(0, total - elapsed), ratio: total ? elapsed / total : null };
}

export type MonthStatus = "en_cours" | "provisoire" | "consolide";

export const STATUS_LABELS: Record<MonthStatus, string> = {
  en_cours: "En cours",
  provisoire: "Provisoire",
  consolide: "Consolidé",
};

/**
 * Statut automatique d'un mois :
 * en cours = mois courant, provisoire = terminé, consolidé après la TVA du mois suivant (25).
 */
export function autoStatus(periodStart: string, now = new Date()): MonthStatus {
  const start = new Date(`${periodStart}T00:00:00`);
  const monthsElapsed = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (monthsElapsed <= 0) return "en_cours";
  if (monthsElapsed === 1) return now.getDate() >= 25 ? "consolide" : "provisoire";
  return "consolide";
}
