import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { durationLabel, fetchTourStats } from "@/lib/stats";

export const Route = createFileRoute("/statistiques/tours")({
  head: () => ({
    meta: [
      { title: "Tours de véhicule — DDA Connect" },
      {
        name: "description",
        content: "Nombre de tours de véhicule réalisés aujourd'hui, cette semaine, ce mois et durée moyenne.",
      },
      { property: "og:title", content: "Tours de véhicule — DDA Connect" },
      { property: "og:description", content: "Suivi de vos tours de véhicule réalisés." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TourStatsPage,
});

function TourStatsPage() {
  const { user, displayName } = useAuth();
  const uid = user?.id ?? "";
  const tours = useQuery({ queryKey: ["tour-stats", uid], queryFn: () => fetchTourStats(uid), enabled: !!uid });

  return (
    <AppShell title="Tours de véhicule" subtitle={displayName} back={{ to: "/statistiques" }}>
      <div className="card-surface space-y-3 p-4">
        <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Mes tours de véhicule</div>
        <div className="grid grid-cols-2 gap-3">
          <Kpi label="Tours aujourd'hui" value={String(tours.data?.today ?? 0)} />
          <Kpi label="Cette semaine" value={String(tours.data?.week ?? 0)} />
          <Kpi label="Ce mois" value={String(tours.data?.month ?? 0)} />
          <Kpi label="Durée moyenne" value={durationLabel(tours.data?.avgSeconds ?? null)} />
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
