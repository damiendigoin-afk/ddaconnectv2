import type { MonthData } from "./store";
import { indicatorByKey } from "./indicators";

export type PeriodPoint = { periodStart: string; values: Map<string, number | null>; sites: number };

/** Somme simple par mois (vue Groupe = DDA + Castillon, sans neutralisation des cessions). */
export function combineByPeriod(data: MonthData[]): PeriodPoint[] {
  const map = new Map<string, PeriodPoint>();
  for (const d of data) {
    const key = d.month.period_start;
    const point = map.get(key) ?? { periodStart: key, values: new Map<string, number | null>(), sites: 0 };
    point.sites++;
    for (const [k, v] of d.values) {
      if (v === null) {
        if (!point.values.has(k)) point.values.set(k, null);
        continue;
      }
      const prev = point.values.get(k);
      point.values.set(k, (prev ?? 0) + v);
    }
    map.set(key, point);
  }
  return [...map.values()].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
}

export function inRange(points: PeriodPoint[], start: string, end: string): PeriodPoint[] {
  return points.filter((p) => p.periodStart >= start && p.periodStart <= end);
}

/**
 * Agrégation d'une période. Les montants et heures se somment, les ratios sont recalculés
 * quand c'est possible, sinon moyennés uniquement sur les mois renseignés.
 */
export function aggregateKey(points: PeriodPoint[], key: string): number | null {
  const unit = indicatorByKey(key)?.unit;
  if (key === "realisation") {
    const billed = plainSum(points, "heures_facturees");
    const purchased = plainSum(points, "heures_achetees");
    if (billed !== null && purchased) return billed / purchased;
  }
  if (unit === "pct") {
    const vals = points.map((p) => p.values.get(key) ?? null).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  return plainSum(points, key);
}

function plainSum(points: PeriodPoint[], key: string): number | null {
  const vals = points.map((p) => p.values.get(key) ?? null).filter((v): v is number => v !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

/** Variation en %, jamais calculée si la référence est absente ou nulle. */
export function variation(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

export function shiftMonths(periodStart: string, delta: number): string {
  const d = new Date(`${periodStart}T00:00:00`);
  const n = new Date(d.getFullYear(), d.getMonth() + delta, 1);
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-01`;
}
