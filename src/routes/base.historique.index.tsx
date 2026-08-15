import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { fetchImports } from "@/lib/refbase";

export const Route = createFileRoute("/base/historique/")({
  head: () => ({
    meta: [
      { title: "Historique des imports — DDA Connect" },
      { name: "description", content: "Historique des imports Winmotor : fichiers, sites, créations, mises à jour et anomalies." },
      { property: "og:title", content: "Historique des imports — DDA Connect" },
      { property: "og:description", content: "Suivi des imports de la base clients et véhicules." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ImportsPage,
});

const STATUS: Record<string, string> = {
  analyzing: "Analyse",
  running: "En cours",
  completed: "Terminé",
  failed: "Échec",
};

function ImportsPage() {
  const { isManager } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ["imports"], queryFn: fetchImports, enabled: isManager });

  if (!isManager) {
    return (
      <AppShell title="Historique des imports" back={{ to: "/base" }}>
        <p className="card-surface p-5 text-sm text-muted-foreground">Réservé aux managers.</p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Historique des imports" back={{ to: "/base" }}>
      <div className="space-y-3">
        {isLoading ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
        {!isLoading && !data?.length ? (
          <p className="card-surface p-5 text-sm text-muted-foreground">Aucun import pour le moment.</p>
        ) : null}
        {(data ?? []).map((i) => (
          <Link
            key={i.id}
            to="/base/historique/$importId"
            params={{ importId: i.id }}
            className="block rounded-xl border-2 border-border bg-card p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-base font-extrabold">{i.file_name}</span>
              <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold uppercase">
                {STATUS[i.status] ?? i.status}
              </span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {new Date(i.created_at).toLocaleString("fr-FR")} · {i.created_by_name ?? "—"}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
              <span>{i.total_rows.toLocaleString("fr-FR")} lignes</span>
              <span>{i.vehicles_created + i.customers_created} créations</span>
              <span>{i.vehicles_updated + i.customers_updated} mises à jour</span>
              <span>{i.anomalies} anomalies</span>
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
