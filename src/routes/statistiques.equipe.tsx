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
  const { sites, active: activeSite, isGroup, setActive } = useSite();
  const uid = user?.id ?? "";
  const access = useQuery({ queryKey: ["access", uid], queryFn: () => fetchModuleAccess(uid), enabled: !!uid });
  const imports = useQuery({ queryKey: ["prod-imports"], queryFn: fetchImports });
  const [range, setRange] = useState<PeriodRange>(() => defaultRange());

  const active = (imports.data ?? []).filter((i) => i.status === "active");
  const entries = useQuery({
    queryKey: ["prod-range", range.start, range.end],
    queryFn: () => fetchEntriesInRange(range),
  });

  // Périmètre : un seul site ou Groupe (somme des sites) — réutilise le contexte site global.
  const scoped = useMemo(
    () => (entries.data ?? []).filter((e) => isGroup || e.site_id === activeSite),
    [entries.data, isGroup, activeSite],
  );

  const rows = useMemo(() => groupByOperator(scoped), [scoped]);
  const totals = useMemo(() => aggregate(scoped), [scoped]);


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

  return (
    <AppShell title="Statistiques équipe" subtitle="Productivité atelier" back={{ to: "/statistiques" }}>
      <div className="space-y-4">
        <PeriodPicker value={range} onChange={setRange} />
        {active.length ? null : (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Aucun rapport de productivité importé pour l'instant.
          </p>
        )}

        {rows.length ? (
          <div className="card-surface space-y-2 p-4">
            <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {rangeLabel(range)}
            </div>
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
                    <tr key={r.name} className="border-t border-border">
                      <td className="py-2">
                        <span className="font-bold">{r.name}</span>
                        {!r.userId ? (
                          <span className="ml-2 rounded px-1 text-[10px] font-bold uppercase text-status-watch">
                            non rattaché
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 text-right font-bold">{pct(r.agg.productivity)}</td>
                      <td className="py-2 text-right">{pct(r.agg.profitability)}</td>
                      <td className="py-2 text-right">{hours(r.agg.billed)}</td>
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
