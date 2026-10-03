/** Début de journée / de mois en heure de Paris (reset du budget IA), renvoyé en ISO UTC. */
const TZ = "Europe/Paris";

function parisParts(d: Date) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { y: g("year"), m: g("month"), d: g("day"), h: g("hour"), mi: g("minute"), s: g("second") };
}

/** Décalage Paris−UTC (ms) à l'instant donné. */
function offsetMs(d: Date) {
  const p = parisParts(d);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(d.getTime() / 1000) * 1000;
}

function parisMidnight(y: number, m: number, day: number) {
  const guess = new Date(Date.UTC(y, m - 1, day));
  return new Date(guess.getTime() - offsetMs(guess)).toISOString();
}

export function parisDayStartIso(now = new Date()) {
  const p = parisParts(now);
  return parisMidnight(p.y, p.m, p.d);
}

export function parisMonthStartIso(now = new Date()) {
  const p = parisParts(now);
  return parisMidnight(p.y, p.m, 1);
}

export type BudgetStatus = { daily: number; spentToday: number; remaining: number };

export function budgetStatus(daily: number, spentToday: number): BudgetStatus {
  const d = Number.isFinite(daily) ? daily : 0;
  const s = Math.round(spentToday * 10000) / 10000;
  return { daily: d, spentToday: s, remaining: Math.max(0, Math.round((d - s) * 10000) / 10000) };
}
