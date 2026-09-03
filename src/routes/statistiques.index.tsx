import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { BarChart3, Upload, Users2 } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { PeriodPicker } from "@/components/PeriodPicker";
import { useAuth } from "@/lib/auth";
import { fetchModuleAccess } from "@/lib/access";
import {
  aggregate,
  defaultRange,
  durationLabel,
  fetchMissingReports,
  fetchMyEntries,
  fetchTourStats,
  hours,
  pct,
  periodLabel,
  rangeLabel,
  type PeriodRange,
} from "@/lib/stats";

export const Route = createFileRoute("/statistiques/")({
  head: () => ({
    meta: [
      { title: "Mes statistiques — DDA Connect" },
      {
        name: "description",
        content: "Productivité, rentabilité et activité atelier du collaborateur, mois par mois.",
      },
      { property: "og:title", content: "Mes statistiques — DDA Connect" },
      { property: "og:description", content: "Productivité, rentabilité et tours véhicule réalisés." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MyStats,
});

function MyStats() {
  const { user, isManager, displayName } = useAuth();
  const uid = user?.id ?? "";
  const entries = useQuery({ queryKey: ["prod-mine", uid], queryFn: () => fetchMyEntries(uid), enabled: !!uid });
  const tours = useQuery({ queryKey: ["tour-stats", uid], queryFn: () => fetchTourStats(uid), enabled: !!uid });
  const access = useQuery({ queryKey: ["access", uid], queryFn: () => fetchModuleAccess(uid), enabled: !!uid });
  const missing = useQuery({ queryKey: ["prod-missing"], queryFn: () => fetchMissingReports() });

  const [range, setRange] = useState<PeriodRange>(() => defaultRange());
  const list = entries.data ?? [];
  const selected = useMemo(
    () => list.filter((e) => e.period_start >= range.start && e.period_start <= range.end),
    [list, range],
  );
  const agg = useMemo(() => aggregate(selected), [selected]);
  const operatorName = selected[0]?.winmotor_name ?? "";

  const canImport = isManager || access.data?.has("stats_import");
  const canTeam = isManager || access.data?.has("stats_equipe");

  return (
    <AppShell title="Mes statistiques" subtitle={displayName} back={{ to: "/" }}>
      <div className="space-y-4">
        {canImport && (missing.data ?? []).length ? (
          <div className="space-y-2 rounded-xl border-2 border-status-watch bg-status-watch-soft p-4">
            {(missing.data ?? []).map((m) => (
              <div key={`${m.siteId}-${m.periodStart}`} className="space-y-1">
                <p className="text-sm font-extrabold uppercase text-status-watch">
                  ⚠ Productivité {periodLabel(m.periodStart)} à importer — {m.siteLabel}
                </p>
                <p className="text-xs text-muted-foreground">
                  Le rapport Winmotor de {periodLabel(m.periodStart).toLowerCase()} n'a pas encore été importé.
                </p>
              </div>
            ))}
            <Link
              to="/statistiques/import"
              className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-3 text-xs font-extrabold uppercase text-brand-foreground"
            >
              <Upload className="h-4 w-4" /> Importer le rapport Winmotor
            </Link>
          </div>
        ) : null}

        <Link
          to="/statistiques/activite"
          className="flex items-center gap-3 rounded-xl border-2 border-border bg-card px-4 py-4"
        >
          <BarChart3 className="h-5 w-5 text-brand" />
          <div className="flex-1 text-sm font-extrabold uppercase">Suivi d'activité mensuel</div>
        </Link>

        <Link
          to="/statistiques/clientele"
          className="flex items-center gap-3 rounded-xl border-2 border-border bg-card px-4 py-4"
        >
          <BarChart3 className="h-5 w-5 text-brand" />
          <div className="flex-1 text-sm font-extrabold uppercase">Clientèle & véhicules</div>
        </Link>

        <PeriodPicker value={range} onChange={setRange} />

        {selected.length ? (
          <div className="card-surface space-y-4 p-4">
            <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {rangeLabel(range)}
              {operatorName ? ` · ${operatorName}` : ""}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Kpi label="Productivité" value={pct(agg.productivity)} strong />
              <Kpi label="Rentabilité" value={pct(agg.profitability)} strong />
              <Kpi label="H achetées" value={hours(agg.purchased)} />
              <Kpi label="H passées" value={hours(agg.spent)} />
              <Kpi label="H facturées" value={hours(agg.billed)} />
            </div>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Aucune statistique Winmotor sur {rangeLabel(range).toLowerCase()} pour votre compte.
          </p>
        )}

        <div className="card-surface space-y-3 p-4">
          <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Activité DDA Connect</div>
          <div className="grid grid-cols-2 gap-3">
            <Kpi label="Tours aujourd'hui" value={String(tours.data?.today ?? 0)} />
            <Kpi label="Cette semaine" value={String(tours.data?.week ?? 0)} />
            <Kpi label="Ce mois" value={String(tours.data?.month ?? 0)} />
            <Kpi label="Durée moyenne" value={durationLabel(tours.data?.avgSeconds ?? null)} />
          </div>
        </div>

        {list.length > 1 ? (
          <div className="card-surface space-y-2 p-4">
            <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Évolution</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1">Mois</th>
                    <th className="py-1 text-right">Prod.</th>
                    <th className="py-1 text-right">Rent.</th>
                    <th className="py-1 text-right">H fact.</th>
                  </tr>
                </thead>
                <tbody>
                  {[...list].reverse().map((e) => (
                    <tr key={e.id} className="border-t border-border">
                      <td className="py-2 font-bold">{periodLabel(e.period_start, e.period_end)}</td>
                      <td className="py-2 text-right">{pct(e.productivity_ratio)}</td>
                      <td className="py-2 text-right">{pct(e.profitability_ratio)}</td>
                      <td className="py-2 text-right">{hours(e.hours_billed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {canTeam ? (
          <Link
            to="/statistiques/equipe"
            className="flex items-center gap-3 rounded-xl border-2 border-border bg-card px-4 py-4"
          >
            <Users2 className="h-5 w-5 text-brand" />
            <div className="flex-1 text-sm font-extrabold uppercase">Statistiques équipe</div>
            <BarChart3 className="h-5 w-5 text-muted-foreground" />
          </Link>
        ) : null}

        {canImport ? (
          <Link
            to="/statistiques/import"
            className="flex items-center gap-3 rounded-xl border-2 border-border bg-card px-4 py-4"
          >
            <Upload className="h-5 w-5 text-brand" />
            <div className="flex-1 text-sm font-extrabold uppercase">Importer productivité Winmotor</div>
          </Link>
        ) : null}
      </div>
    </AppShell>
  );
}

function Kpi({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-secondary px-3 py-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={strong ? "text-2xl font-extrabold text-brand" : "text-lg font-extrabold"}>{value}</div>
    </div>
  );
}
