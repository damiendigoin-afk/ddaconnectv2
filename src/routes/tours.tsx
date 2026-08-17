import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

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
  const [scope, setScope] = useState<"completed" | "open">("completed");
  const tours = useQuery({
    queryKey: ["all-tours", scope],
    queryFn: () => fetchRecentTours(100, scope),
  });
  return (
    <AppShell
      title="Tours véhicule"
      subtitle={scope === "completed" ? "Historique des tours clôturés" : "Travaux à terminer"}
      back={{ to: "/tour-vehicule" }}
    >
      <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl bg-secondary p-1">
        <button
          onClick={() => setScope("completed")}
          className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-widest ${scope === "completed" ? "bg-card shadow-sm" : "text-muted-foreground"}`}
        >
          Tours clôturés
        </button>
        <button
          onClick={() => setScope("open")}
          className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-widest ${scope === "open" ? "bg-card shadow-sm" : "text-muted-foreground"}`}
        >
          Brouillons / en cours
        </button>
      </div>
      <div className="space-y-2">
        {(tours.data ?? []).map((t) => (
          <TourRow key={t.id} t={t} resume={scope === "open"} />
        ))}
        {tours.data?.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {scope === "completed" ? "Aucun tour clôturé." : "Aucun brouillon en attente."}
          </p>
        ) : null}
      </div>
    </AppShell>
  );
}
