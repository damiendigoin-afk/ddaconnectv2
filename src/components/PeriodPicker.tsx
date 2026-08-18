import { useState } from "react";
import { CalendarRange, ChevronLeft, ChevronRight, X } from "lucide-react";

import { addMonths, monthOptions, periodLabel, rangeLabel, type PeriodRange } from "@/lib/stats";

/**
 * Sélecteur de période : ‹ Juillet 2026 › avec navigation mois par mois,
 * et ouverture d'un panneau pour choisir plusieurs mois consécutifs ou une année.
 */
export function PeriodPicker({
  value,
  onChange,
}: {
  value: PeriodRange;
  onChange: (r: PeriodRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const months = monthOptions();
  const span = monthsBetween(value.start, value.end);

  function shift(delta: number) {
    onChange({ start: addMonths(value.start, delta), end: addMonths(value.end, delta) });
  }

  function setStart(start: string) {
    const end = value.end < start ? start : value.end;
    onChange({ start, end: monthsBetween(start, end) > 12 ? addMonths(start, 11) : end });
  }

  function setEnd(end: string) {
    const start = value.start > end ? end : value.start;
    onChange({ start: monthsBetween(start, end) > 12 ? addMonths(end, -11) : start, end });
  }

  function year(y: number) {
    onChange({ start: `${y}-01-01`, end: `${y}-12-01` });
    setOpen(false);
  }

  const currentYear = new Date().getFullYear();

  return (
    <>
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => shift(-1)}
          aria-label="Période précédente"
          className="rounded-xl border-2 border-border bg-card px-3"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-border bg-card px-3 py-3 text-sm font-extrabold uppercase"
        >
          <CalendarRange className="h-4 w-4 text-brand" />
          {rangeLabel(value)}
        </button>
        <button
          type="button"
          onClick={() => shift(1)}
          aria-label="Période suivante"
          className="rounded-xl border-2 border-border bg-card px-3"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      {span > 1 ? (
        <p className="mt-1 text-center text-xs text-muted-foreground">{span} mois agrégés</p>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-md space-y-3 rounded-t-2xl bg-card p-4 pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-extrabold uppercase tracking-widest">Choisir la période</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Fermer" className="rounded-lg p-1">
                <X className="h-5 w-5" />
              </button>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-muted-foreground">Du mois</span>
              <select
                value={value.start}
                onChange={(e) => setStart(e.target.value)}
                className="w-full rounded-lg border-2 border-border bg-card px-3 py-3 text-sm font-bold"
              >
                {months.map((m) => (
                  <option key={m} value={m}>
                    {periodLabel(m)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-muted-foreground">Au mois</span>
              <select
                value={value.end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-full rounded-lg border-2 border-border bg-card px-3 py-3 text-sm font-bold"
              >
                {months.map((m) => (
                  <option key={m} value={m}>
                    {periodLabel(m)}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => year(currentYear)}
                className="rounded-lg border-2 border-border px-3 py-3 text-xs font-extrabold uppercase"
              >
                Année {currentYear}
              </button>
              <button
                type="button"
                onClick={() => year(currentYear - 1)}
                className="rounded-lg border-2 border-border px-3 py-3 text-xs font-extrabold uppercase"
              >
                Année {currentYear - 1}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-extrabold uppercase text-brand-foreground"
            >
              Appliquer
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function monthsBetween(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
}
