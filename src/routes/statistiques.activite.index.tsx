import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AlertTriangle, LineChart as LineChartIcon, Upload } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AppShell } from "@/components/AppShell";
import { INDICATORS, MAIN_KPIS, SECTIONS, indicatorByKey } from "@/lib/activity/indicators";
import { SITE_LABELS, type SiteCode } from "@/lib/activity/parse";
import { aggregateKey, combineByPeriod, inRange, shiftMonths, variation } from "@/lib/activity/series";
import { fetchImports, fetchMonths, setMonthStatus } from "@/lib/activity/store";
import { STATUS_LABELS, autoStatus, monthProgress, type MonthStatus } from "@/lib/activity/workdays";
import { periodLabel } from "@/lib/stats";

export const Route = createFileRoute("/statistiques/activite/")({
  head: () => ({
    meta: [
      { title: "Suivi d'activité mensuel — DDA Connect" },
      {
        name: "description",
        content:
          "Tableau de bord mensuel des deux sociétés : chiffre d'affaires, marge APV, heures, entrées atelier et comparatifs N-1.",
      },
      { property: "og:title", content: "Suivi d'activité mensuel — DDA Connect" },
      { property: "og:description", content: "CA, marge, heures et entrées atelier par site et par mois." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ActivityDashboard,
});

type SiteChoice = SiteCode | "groupe";
type Compare = "none" | "n1" | "n2" | "prev";

function monthKeyNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function fmt(key: string, v: number | null): string {
  if (v === null || v === undefined) return "—";
  const unit = indicatorByKey(key)?.unit;
  if (unit === "pct") return `${(v * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
  if (unit === "h") return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} h`;
  if (unit === "nb") return v.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`;
}

function ActivityDashboard() {
  const qc = useQueryClient();
  const [site, setSite] = useState<SiteChoice>("groupe");
  const [start, setStart] = useState<string>(monthKeyNow());
  const [end, setEnd] = useState<string>(monthKeyNow());
  const [compare, setCompare] = useState<Compare>("n1");
  const [chartKey, setChartKey] = useState<string>("ca_total");

  const months = useQuery({ queryKey: ["activity-months", site], queryFn: () => fetchMonths(site) });
  const imports = useQuery({ queryKey: ["activity-imports"], queryFn: fetchImports });

  const points = useMemo(() => combineByPeriod(months.data ?? []), [months.data]);
  const current = useMemo(() => inRange(points, start, end), [points, start, end]);

  const span = useMemo(() => {
    const a = new Date(`${start}T00:00:00`);
    const b = new Date(`${end}T00:00:00`);
    return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
  }, [start, end]);

  const shift = compare === "n1" ? -12 : compare === "n2" ? -24 : compare === "prev" ? -span : 0;
  const previous = useMemo(
    () => (shift ? inRange(points, shiftMonths(start, shift), shiftMonths(end, shift)) : []),
    [points, start, end, shift],
  );

  const monthRows = useMemo(
    () => (months.data ?? []).filter((m) => m.month.period_start >= start && m.month.period_start <= end),
    [months.data, start, end],
  );

  const progress = monthProgress(end);
  const objective = aggregateKey(current, "heures_facturees");
  const objectiveTarget = aggregateKey(current, "objectif_heures");
  const objectiveRatio = objectiveTarget ? (objective ?? 0) / objectiveTarget : null;

  const lastImport = (imports.data ?? []).find((i) => site === "groupe" || i.site_code === site);
  const anomalies = lastImport?.anomalies ?? [];
  const [showAnomalies, setShowAnomalies] = useState(false);

  const chartData = useMemo(() => {
    return current.map((p, i) => ({
      mois: periodLabel(p.periodStart).slice(0, 3) + " " + p.periodStart.slice(2, 4),
      valeur: p.values.get(chartKey) ?? null,
      comparaison: shift ? (previous[i]?.values.get(chartKey) ?? null) : null,
    }));
  }, [current, previous, chartKey, shift]);

  const monthOptions = useMemo(() => {
    const known = points.map((p) => p.periodStart);
    const base = new Set<string>([...known, monthKeyNow()]);
    for (let i = 1; i <= 36; i++) base.add(shiftMonths(monthKeyNow(), -i));
    return [...base].sort((a, b) => b.localeCompare(a));
  }, [points]);

  return (
    <AppShell title="Suivi d'activité" subtitle="Tableau de bord mensuel" back={{ to: "/statistiques" }}>
      <div className="space-y-4">
        <div className="card-surface space-y-3 p-4">
          <div className="grid grid-cols-3 gap-2">
            {(["dda", "castillon", "groupe"] as SiteChoice[]).map((s) => (
              <button
                key={s}
                onClick={() => setSite(s)}
                className={`rounded-lg border-2 px-2 py-2 text-xs font-extrabold uppercase ${
                  site === s ? "border-brand bg-brand text-brand-foreground" : "border-border bg-card"
                }`}
              >
                {s === "groupe" ? "Groupe" : SITE_LABELS[s as SiteCode]}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Du mois">
              <select value={start} onChange={(e) => setStart(e.target.value)} className="w-full bg-transparent text-sm font-bold">
                {monthOptions.map((m) => (
                  <option key={m} value={m}>
                    {periodLabel(m)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Au mois">
              <select value={end} onChange={(e) => setEnd(e.target.value)} className="w-full bg-transparent text-sm font-bold">
                {monthOptions.map((m) => (
                  <option key={m} value={m}>
                    {periodLabel(m)}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="flex flex-wrap gap-2">
            <Preset label="Mois en cours" onClick={() => { setStart(monthKeyNow()); setEnd(monthKeyNow()); }} />
            <Preset
              label="Trimestre"
              onClick={() => { setEnd(monthKeyNow()); setStart(shiftMonths(monthKeyNow(), -2)); }}
            />
            <Preset
              label="Exercice (avr→mars)"
              onClick={() => {
                const fy = fiscalYearRange(end);
                setStart(fy.start);
                setEnd(fy.end);
              }}
            />

          </div>

          <Field label="Comparaison">
            <select value={compare} onChange={(e) => setCompare(e.target.value as Compare)} className="w-full bg-transparent text-sm font-bold">
              <option value="none">Aucune</option>
              <option value="n1">N-1</option>
              <option value="n2">N-2</option>
              <option value="prev">Période précédente</option>
            </select>
          </Field>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-bold uppercase">
              {periodLabel(start)}
              {start !== end ? ` → ${periodLabel(end)}` : ""}
            </span>
            <span className="uppercase">· {fiscalYearLabel(end)}</span>

            {monthRows.map((m) => (
              <StatusChip
                key={m.month.id}
                monthId={m.month.id}
                period={m.month.period_start}
                status={(m.month.status as MonthStatus) ?? autoStatus(m.month.period_start)}
                onChanged={() => void qc.invalidateQueries({ queryKey: ["activity-months"] })}
              />
            ))}
            {lastImport ? <span>· dernier import {new Date(lastImport.created_at).toLocaleDateString("fr-FR")}</span> : null}
          </div>
        </div>

        {anomalies.length ? (
          <div className="rounded-xl border-2 border-status-watch bg-status-watch-soft p-4">
            <button
              onClick={() => setShowAnomalies((v) => !v)}
              className="flex w-full items-center gap-2 text-left text-sm font-extrabold uppercase text-status-watch"
            >
              <AlertTriangle className="h-4 w-4" />
              Import avec anomalies : {anomalies.length} données manquantes
            </button>
            {showAnomalies ? (
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {anomalies.slice(0, 60).map((a, i) => (
                  <li key={i}>{a.message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {!current.length ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Aucune donnée importée sur cette période. Importez le fichier Excel de suivi mensuel.
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          {MAIN_KPIS.map((key) => {
            const cur = aggregateKey(current, key);
            const prev = shift ? aggregateKey(previous, key) : null;
            const v = variation(cur, prev);
            return (
              <div key={key} className="card-surface p-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  {indicatorByKey(key)?.label ?? key}
                </div>
                <div className="text-lg font-extrabold">{fmt(key, cur)}</div>
                {cur === null ? <div className="text-[10px] uppercase text-muted-foreground">donnée manquante</div> : null}
                {shift ? (
                  <div className="text-[11px] text-muted-foreground">
                    {fmt(key, prev)} ·{" "}
                    {v === null ? "N/A" : `${v > 0 ? "+" : ""}${(v * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="card-surface space-y-1 p-4">
          <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Avancement du mois</div>
          <div className="text-sm font-bold">
            {progress.total} jours ouvrés · {progress.elapsed} écoulés · {progress.remaining} restants
          </div>
          <div className="text-sm">
            {progress.ratio === null ? "—" : `${Math.round(progress.ratio * 100)} % du mois écoulé`}
            {objectiveRatio !== null ? ` / ${Math.round(objectiveRatio * 100)} % de l'objectif réalisé` : " / objectif non renseigné"}
          </div>
        </div>

        <div className="card-surface space-y-2 p-4">
          <div className="flex items-center gap-2">
            <LineChartIcon className="h-4 w-4 text-brand" />
            <select value={chartKey} onChange={(e) => setChartKey(e.target.value)} className="flex-1 bg-transparent text-sm font-bold">
              {INDICATORS.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.label}
                </option>
              ))}
            </select>
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="mois" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={56} />
                <Tooltip formatter={(v: number) => fmt(chartKey, v)} />
                <Line type="monotone" dataKey="valeur" stroke="hsl(var(--brand))" strokeWidth={2} dot={false} connectNulls />
                {shift ? (
                  <Line type="monotone" dataKey="comparaison" stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeWidth={2} dot={false} connectNulls />
                ) : null}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {SECTIONS.map((section) => {
          const rows = INDICATORS.filter((i) => i.section === section.key);
          return (
            <div key={section.key} className="card-surface space-y-2 p-4">
              <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{section.label}</div>
              <table className="w-full text-xs">
                <tbody>
                  {rows.map((i) => {
                    const cur = aggregateKey(current, i.key);
                    const prev = shift ? aggregateKey(previous, i.key) : null;
                    const v = variation(cur, prev);
                    return (
                      <tr key={i.key} className="border-t border-border">
                        <td className="py-1">{i.label}</td>
                        <td className="py-1 text-right font-bold">
                          {cur === null ? <span className="text-muted-foreground">— donnée manquante</span> : fmt(i.key, cur)}
                        </td>
                        {shift ? (
                          <td className="w-20 py-1 text-right text-muted-foreground">
                            {v === null ? "N/A" : `${v > 0 ? "+" : ""}${Math.round(v * 100)} %`}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}

        <Link
          to="/statistiques/activite/import"
          className="flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-4 text-sm font-extrabold uppercase text-brand-foreground"
        >
          <Upload className="h-4 w-4" /> Importer Excel
        </Link>
      </div>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="rounded-lg border-2 border-border bg-card px-3 py-2">
      <span className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Preset({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-lg border-2 border-border px-3 py-1 text-[11px] font-bold uppercase">
      {label}
    </button>
  );
}

function StatusChip({
  monthId,
  period,
  status,
  onChanged,
}: {
  monthId: string;
  period: string;
  status: MonthStatus;
  onChanged: () => void;
}) {
  return (
    <select
      value={status}
      onChange={async (e) => {
        await setMonthStatus(monthId, e.target.value as MonthStatus);
        onChanged();
      }}
      className="rounded border border-border bg-card px-1 py-0.5 text-[11px] font-bold uppercase"
      title={`Statut ${periodLabel(period)}`}
    >
      {(Object.keys(STATUS_LABELS) as MonthStatus[]).map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}
