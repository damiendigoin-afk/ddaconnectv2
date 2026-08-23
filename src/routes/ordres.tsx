import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/AppShell";
import { OrCard } from "@/components/OrCard";
import { fetchRecentOrders } from "@/lib/queries";

export const Route = createFileRoute("/ordres")({
  head: () => ({
    meta: [
      { title: "Toutes les interventions — DDA Connect" },
      {
        name: "description",
        content: "Liste complète des interventions DDA, avec leur OR WinMotor lorsqu'il existe.",
      },
      { property: "og:title", content: "Toutes les interventions — DDA Connect" },
      { property: "og:description", content: "Liste complète des interventions DDA." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AllOrders,
});

function AllOrders() {
  const orders = useQuery({ queryKey: ["all-orders"], queryFn: () => fetchRecentOrders(100) });
  return (
    <AppShell title="Interventions" subtitle="Historique complet" back={{ to: "/tour-vehicule" }}>
      <div className="space-y-2">
        {(orders.data ?? []).map((o) => (
          <OrCard key={o.id} o={o as never} />
        ))}
        {orders.data?.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Aucune intervention.
          </p>
        ) : null}
      </div>
    </AppShell>
  );
}
