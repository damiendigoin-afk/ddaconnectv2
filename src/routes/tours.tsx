import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/AppShell";
import { TourRow } from "@/components/RecentTours";
import { fetchRecentTours } from "@/lib/queries";

export const Route = createFileRoute("/tours")({
  head: () => ({
    meta: [
      { title: "Tous les tours véhicule — DDA Connect" },
      {
        name: "description",
        content: "Historique complet des tours véhicule réalisés à l'atelier et de leur envoi client.",
      },
      { property: "og:title", content: "Tous les tours véhicule — DDA Connect" },
      { property: "og:description", content: "Historique complet des tours véhicule." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AllTours,
});

function AllTours() {
  const tours = useQuery({ queryKey: ["all-tours"], queryFn: () => fetchRecentTours(100) });
  return (
    <AppShell title="Tours véhicule" subtitle="Historique complet" back={{ to: "/tour-vehicule" }}>
      <div className="space-y-2">
        {(tours.data ?? []).map((t) => (
          <TourRow key={t.id} t={t} />
        ))}
        {tours.data?.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Aucun tour véhicule.
          </p>
        ) : null}
      </div>
    </AppShell>
  );
}
