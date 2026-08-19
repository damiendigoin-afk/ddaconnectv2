import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/AppShell";
import { Badge, Section } from "@/components/bits";
import { useAuth } from "@/lib/auth";
import { fetchPlatformHealth, healthTone } from "@/lib/pilotage";

export const Route = createFileRoute("/parametrage/sante")({
  head: () => ({
    meta: [
      { title: "Santé plateforme — DDA Connect" },
      {
        name: "description",
        content:
          "Santé de la plateforme DDA Connect : stockage fichiers, taille de la base, emails envoyés, quotas restants, erreurs et alertes.",
      },
      { property: "og:title", content: "Santé plateforme — DDA Connect" },
      { property: "og:description", content: "Stockage, quotas, emails et automatisations sous surveillance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HealthPage,
});

function fmtSize(mo: number): string {
  return mo >= 1024 ? `${(mo / 1024).toFixed(2)} Go` : `${Math.round(mo)} Mo`;
}

function HealthPage() {
  const { isManager } = useAuth();
  const health = useQuery({ queryKey: ["plateforme", "sante"], queryFn: fetchPlatformHealth, enabled: isManager });

  if (!isManager) {
    return (
      <AppShell title="Santé plateforme" back={{ to: "/parametrage" }}>
        <p className="rounded-lg bg-amber-100 px-3 py-3 text-sm text-amber-950">Accès réservé aux managers.</p>
      </AppShell>
    );
  }

  const alerts = (health.data?.metrics ?? []).filter((m) => healthTone(m) !== "ok").length;

  return (
    <AppShell
      title="Santé plateforme"
      subtitle={health.data ? (alerts ? `${alerts} indicateur(s) à surveiller` : "Tout est au vert") : "Analyse…"}
      back={{ to: "/parametrage" }}
    >
      <Section title="Indicateurs">
        {health.isLoading ? <p className="text-sm text-muted-foreground">Analyse en cours…</p> : null}
        <div className="space-y-2">
          {(health.data?.metrics ?? []).map((m) => {
            const tone = healthTone(m);
            const pct = m.quota ? Math.min(100, (m.value / m.quota) * 100) : 0;
            return (
              <div key={m.key} className="rounded-xl border-2 border-border bg-card p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-extrabold uppercase tracking-wide">{m.label}</span>
                  <Badge
                    tone={
                      tone === "critique"
                        ? "bg-status-alert-soft text-status-alert"
                        : tone === "alerte"
                          ? "bg-status-watch-soft text-status-watch"
                          : "bg-secondary text-foreground"
                    }
                  >
                    {m.unit === "mo" ? fmtSize(m.value) : m.value}
                    {m.quota ? ` / ${m.unit === "mo" ? fmtSize(m.quota) : m.quota}` : ""}
                    {m.quota ? ` · ${Math.round((m.value / m.quota) * 100)} %` : ""}
                  </Badge>
                </div>
                <div className="mt-2 h-2 rounded bg-secondary">
                  <div
                    className={`h-2 rounded ${tone === "critique" ? "bg-status-alert" : tone === "alerte" ? "bg-status-watch" : "bg-brand"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{m.hint}</p>
              </div>
            );
          })}
        </div>
        <div className="mt-3 rounded-xl border-2 border-border bg-card p-3 text-xs text-muted-foreground">
          Automatisations (30 j) : {health.data?.failedRuns ?? 0} exécution(s) en erreur
          {health.data?.lastRunAt ? ` · dernière le ${new Date(health.data.lastRunAt).toLocaleString("fr-FR")}` : ""}.{" "}
          <Link to="/automatisations" className="font-bold text-brand underline">
            Voir le détail
          </Link>
        </div>
      </Section>
    </AppShell>
  );
}
