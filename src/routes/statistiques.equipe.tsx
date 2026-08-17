import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FileText, Upload } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { PeriodPicker } from "@/components/PeriodPicker";
import { useAuth } from "@/lib/auth";
import { fetchModuleAccess } from "@/lib/access";
import {
  aggregate,
  defaultRange,
  fetchEntriesInRange,
  fetchImports,
  groupByOperator,
  hours,
  openReportFile,
  pct,
  periodLabel,
  rangeLabel,
  type PeriodRange,
} from "@/lib/stats";

export const Route = createFileRoute("/statistiques/equipe")({
  head: () => ({
    meta: [
      { title: "Statistiques équipe — DDA Connect" },
      {
        name: "description",
        content: "Productivité et rentabilité de l'atelier par collaborateur et par mois, issues des rapports Winmotor.",
      },
      { property: "og:title", content: "Statistiques équipe — DDA Connect" },
      { property: "og:description", content: "Suivi mensuel de la productivité de l'atelier." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TeamStats,
});

function TeamStats() {
  const { user, isManager } = useAuth();
  const uid = user?.id ?? "";
  const access = useQuery({ queryKey: ["access", uid], queryFn: () => fetchModuleAccess(uid), enabled: !!uid });
  const imports = useQuery({ queryKey: ["prod-imports"], queryFn: fetchImports });
  const [range, setRange] = useState<PeriodRange>(() => defaultRange());

  const active = (imports.data ?? []).filter((i) => i.status === "active");
  const entries = useQuery({
    queryKey: ["prod-range", range.start, range.end],
    queryFn: () => fetchEntriesInRange(range),
  });

  const rows = useMemo(
    () => [...(entries.data ?? [])].sort((a, b) => (b.productivity_ratio ?? 0) - (a.productivity_ratio ?? 0)),
    [entries.data],
  );
  const totals = useMemo(() => {
    const s = (f: (r: (typeof rows)[number]) => number | null) =>
      rows.reduce((a, r) => a + (f(r) ?? 0), 0) || null;
    return { purchased: s((r) => r.hours_purchased), spent: s((r) => r.hours_spent), billed: s((r) => r.hours_billed) };
  }, [rows]);

  const allowed = isManager || access.data?.has("stats_equipe");
  if (!allowed) {
    return (
      <AppShell title="Statistiques équipe" back={{ to: "/statistiques" }}>
        <div className="card-surface p-5 text-sm">
          <p className="font-bold uppercase">Accès réservé</p>
          <p className="mt-1 text-muted-foreground">Les statistiques de l'équipe ne sont pas activées sur votre profil.</p>
        </div>
      </AppShell>
    );
  }

  const periods = Array.from(new Set(active.map((i) => i.period_start)));

  return (
    <AppShell title="Statistiques équipe" subtitle="Productivité atelier" back={{ to: "/statistiques" }}>
      <div className="space-y-4">
        {periods.length ? (
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted-foreground">Période</span>
            <select
              value={currentPeriod}
              onChange={(e) => setPeriod(e.target.value)}
              className="w-full rounded-lg border-2 border-border bg-card px-3 py-3 text-sm font-bold"
            >
              {periods.map((p) => (
                <option key={p} value={p}>
                  {periodLabel(p)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Aucun rapport de productivité importé pour l'instant.
          </p>
        )}

        {rows.length ? (
          <div className="card-surface space-y-2 p-4">
            <div className="grid grid-cols-3 gap-3">
              <Kpi label="H achetées" value={hours(totals.purchased)} />
              <Kpi label="H passées" value={hours(totals.spent)} />
              <Kpi label="H facturées" value={hours(totals.billed)} />
            </div>
            <div className="overflow-x-auto pt-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1">Productif</th>
                    <th className="py-1 text-right">Prod.</th>
                    <th className="py-1 text-right">Rent.</th>
                    <th className="py-1 text-right">H fact.</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="py-2">
                        <span className="font-bold">{r.winmotor_name}</span>
                        {!r.user_id ? (
                          <span className="ml-2 rounded px-1 text-[10px] font-bold uppercase text-status-watch">
                            non rattaché
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 text-right font-bold">{pct(r.productivity_ratio)}</td>
                      <td className="py-2 text-right">{pct(r.profitability_ratio)}</td>
                      <td className="py-2 text-right">{hours(r.hours_billed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <div className="px-1 text-sm font-extrabold uppercase tracking-wide">Historique des imports</div>
          {(imports.data ?? []).map((i) => (
            <div key={i.id} className="card-surface flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold uppercase">
                  {periodLabel(i.period_start, i.period_end)}
                  {i.status !== "active" ? (
                    <span className="ml-2 text-[10px] font-bold uppercase text-muted-foreground">remplacé</span>
                  ) : null}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {i.site_label ?? "—"} · {i.imported_by_name ?? "—"} ·{" "}
                  {new Date(i.created_at).toLocaleDateString("fr-FR")}
                </div>
              </div>
              {i.storage_path ? (
                <button
                  onClick={() => void openReportFile(i.storage_path as string)}
                  className="rounded-lg border-2 border-border px-3 py-2 text-xs font-bold uppercase"
                >
                  <FileText className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          ))}
        </div>

        <Link
          to="/statistiques/import"
          className="flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-4 text-sm font-extrabold uppercase text-brand-foreground"
        >
          <Upload className="h-4 w-4" /> Importer un rapport
        </Link>
      </div>
    </AppShell>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary px-3 py-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-base font-extrabold">{value}</div>
    </div>
  );
}
