import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { PeriodPicker } from "@/components/PeriodPicker";
import { useAuth } from "@/lib/auth";
import { useSite } from "@/lib/site-context";
import {
  aggregateTours,
  defaultRange,
  durationLabel,
  fetchCompletedToursInRange,
  fetchTourStats,
  groupToursByOperator,
  rangeLabel,
  type PeriodRange,
} from "@/lib/stats";

export const Route = createFileRoute("/statistiques/tours")({
  head: () => ({
    meta: [
      { title: "Tours de véhicule — DDA Connect" },
      {
        name: "description",
        content: "Nombre de tours de véhicule terminés et durée moyenne, par mois et par compagnon.",
      },
      { property: "og:title", content: "Tours de véhicule — DDA Connect" },
      { property: "og:description", content: "Suivi mensuel des tours de véhicule réalisés." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TourStatsPage,
});

function TourStatsPage() {
  const { user, displayName } = useAuth();
  const { active: activeSite, isGroup } = useSite();
  const uid = user?.id ?? "";
  const [range, setRange] = useState<PeriodRange>(() => defaultRange());

  // Indicateurs temps réel (jour / semaine), indépendants du mois sélectionné.
  const live = useQuery({ queryKey: ["tour-stats", uid], queryFn: () => fetchTourStats(uid), enabled: !!uid });

  // Tours terminés sur la période sélectionnée, même périmètre société que la productivité.
  const tours = useQuery({
    queryKey: ["tours-range", range.start, range.end],
    queryFn: () => fetchCompletedToursInRange(range),
  });
  const scopedTours = useMemo(
    () => (tours.data ?? []).filter((t) => isGroup || t.site_id === activeSite),
    [tours.data, isGroup, activeSite],
  );
  const tourRows = useMemo(() => groupToursByOperator(scopedTours), [scopedTours]);
  const tourTotals = useMemo(() => aggregateTours(scopedTours), [scopedTours]);

  return (
    <AppShell title="Tours de véhicule" subtitle={displayName} back={{ to: "/statistiques" }}>
      <div className="space-y-4">
        <div className="card-surface space-y-3 p-4">
          <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            En temps réel
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Kpi label="Tours aujourd'hui" value={String(live.data?.today ?? 0)} />
            <Kpi label="Cette semaine" value={String(live.data?.week ?? 0)} />
          </div>
        </div>

        <PeriodPicker value={range} onChange={setRange} />

        <div className="card-surface space-y-2 p-4">
          <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Tours terminés — {rangeLabel(range)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Kpi label="Tours terminés" value={String(tourTotals.count)} />
            <Kpi label="Durée moyenne" value={durationLabel(tourTotals.avgSeconds)} />
          </div>
          {tourRows.length ? (
            <div className="overflow-x-auto pt-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1">Compagnon</th>
                    <th className="py-1 text-right">Tours</th>
                    <th className="py-1 text-right">Durée moy.</th>
                  </tr>
                </thead>
                <tbody>
                  {tourRows.map((r) => (
                    <tr key={r.name} className="border-t border-border">
                      <td className="py-2 font-bold">{r.name}</td>
                      <td className="py-2 text-right font-bold">{r.agg.count}</td>
                      <td className="py-2 text-right">{durationLabel(r.agg.avgSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border font-extrabold">
                    <td className="py-2 uppercase">Total</td>
                    <td className="py-2 text-right">{tourTotals.count}</td>
                    <td className="py-2 text-right">{durationLabel(tourTotals.avgSeconds)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Aucun tour véhicule terminé sur cette période.
            </p>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary px-3 py-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-extrabold">{value}</div>
    </div>
  );
}
