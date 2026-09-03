import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { fetchSites, GROUP_LABEL } from "@/lib/sites";

export const Route = createFileRoute("/statistiques/clientele")({
  head: () => ({
    meta: [
      { title: "Statistiques clientèle et véhicules — DDA Connect" },
      {
        name: "description",
        content:
          "Parc véhicules et clientèle par établissement : volumes, répartition Renault / Dacia / autres, contacts exploitables et visites récentes.",
      },
      { property: "og:title", content: "Statistiques clientèle et véhicules — DDA Connect" },
      { property: "og:description", content: "Parc, marques et fraîcheur des visites par site et Groupe." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClienteleStats,
});

type Scope = { key: string; label: string; siteId: string | null };

type Stats = {
  vehicles: number;
  renault: number;
  dacia: number;
  other: number;
  recent: number;
  customers: number;
  reachable: number;
};

async function countVehicles(siteId: string | null, apply: (q: ReturnType<typeof baseQuery>) => unknown) {
  const q = baseQuery();
  if (siteId) q.eq("site_id", siteId);
  apply(q);
  const { count } = await (q as unknown as Promise<{ count: number | null }>);
  return count ?? 0;
}

function baseQuery() {
  return supabase.from("ref_vehicles").select("id", { count: "exact", head: true });
}

async function statsFor(siteId: string | null): Promise<Stats> {
  const since = new Date();
  since.setMonth(since.getMonth() - 24);
  const sinceIso = since.toISOString();

  const [vehicles, renault, dacia, recent, customers, reachable] = await Promise.all([
    countVehicles(siteId, () => undefined),
    countVehicles(siteId, (q) => q.ilike("brand", "%renault%")),
    countVehicles(siteId, (q) => q.ilike("brand", "%dacia%")),
    countVehicles(siteId, (q) => q.gte("last_visit_at", sinceIso)),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .then((r) => r.count ?? 0),
    supabase
      .from("customer_contacts")
      .select("customer_id", { count: "exact", head: true })
      .eq("active", true)
      .then((r) => r.count ?? 0),
  ]);

  return {
    vehicles,
    renault,
    dacia,
    other: Math.max(vehicles - renault - dacia, 0),
    recent,
    customers,
    reachable,
  };
}

function pct(part: number, total: number): string {
  if (!total) return "—";
  return `${Math.round((part / total) * 100)} %`;
}

function ClienteleStats() {
  const sites = useQuery({ queryKey: ["sites"], queryFn: fetchSites });
  const scopes: Scope[] = [
    ...(sites.data ?? []).map((s) => ({ key: s.id, label: s.name, siteId: s.id })),
    { key: "groupe", label: GROUP_LABEL, siteId: null },
  ];

  const stats = useQuery({
    queryKey: ["clientele-stats", scopes.map((s) => s.key).join(",")],
    enabled: scopes.length > 0,
    queryFn: async () => {
      const out: { scope: Scope; stats: Stats }[] = [];
      for (const scope of scopes) out.push({ scope, stats: await statsFor(scope.siteId) });
      return out;
    },
  });

  return (
    <AppShell title="Clientèle & véhicules" subtitle="Parc par établissement" back={{ to: "/statistiques" }}>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Données issues des imports Winmotor. Les champs absents restent inconnus, jamais estimés.
        </p>
        {(stats.data ?? []).map(({ scope, stats: s }) => (
          <section key={scope.key} className="card-surface space-y-2 p-4">
            <h2 className="text-sm font-extrabold uppercase">{scope.label}</h2>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <Kpi label="Véhicules" value={s.vehicles.toLocaleString("fr-FR")} />
              <Kpi label="Clients" value={s.customers.toLocaleString("fr-FR")} />
              <Kpi label="Visite < 24 mois" value={pct(s.recent, s.vehicles)} />
              <Kpi label="Renault" value={pct(s.renault, s.vehicles)} />
              <Kpi label="Dacia" value={pct(s.dacia, s.vehicles)} />
              <Kpi label="Autres marques" value={pct(s.other, s.vehicles)} />
            </div>
            <p className="text-xs text-muted-foreground">
              Contacts exploitables enregistrés : {s.reachable.toLocaleString("fr-FR")}
            </p>
          </section>
        ))}
        {stats.isLoading ? <p className="text-xs text-muted-foreground">Calcul en cours…</p> : null}
      </div>
    </AppShell>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border py-2">
      <div className="text-base font-extrabold">{value}</div>
      <div className="uppercase text-muted-foreground">{label}</div>
    </div>
  );
}
