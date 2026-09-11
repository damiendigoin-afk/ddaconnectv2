/** Historique des devis pneus : recherche client / immatriculation / dimension. */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/AppShell";
import { fetchTireQuotes } from "@/lib/tire-quotes";

export const Route = createFileRoute("/devis/pneus/historique")({
  head: () => ({
    meta: [
      { title: "Historique des devis pneus — DDA Connect" },
      {
        name: "description",
        content: "Retrouvez les derniers devis pneumatiques par client, immatriculation ou dimension.",
      },
      { property: "og:title", content: "Historique des devis pneus — DDA Connect" },
      { property: "og:description", content: "Consultation et réimpression des devis pneumatiques." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const [search, setSearch] = useState("");
  const q = useQuery({ queryKey: ["tire-quotes", search], queryFn: () => fetchTireQuotes(search) });
  const rows = q.data ?? [];

  return (
    <AppShell title="Historique devis pneus" back={{ to: "/devis/pneus" }}>
      <div className="space-y-3">
        <label className="flex items-center gap-2 rounded-xl border-2 border-border bg-card px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Client, immatriculation ou dimension"
            className="h-12 w-full bg-transparent text-base font-semibold outline-none"
          />
        </label>

        {q.isLoading ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
        {!q.isLoading && !rows.length ? (
          <p className="text-sm text-muted-foreground">Aucun devis pneus enregistré pour cette recherche.</p>
        ) : null}

        {rows.map((r) => (
          <Link
            key={r.id}
            to="/devis/pneus/$quoteId"
            params={{ quoteId: r.id }}
            className="block rounded-xl border-2 border-border bg-card px-4 py-3"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-extrabold uppercase">{r.size}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(r.created_at).toLocaleDateString("fr-FR")}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {[r.customer_name, r.plate, r.vehicle_label, r.requested_brand ? `Marque : ${r.requested_brand}` : ""]
                .filter(Boolean)
                .join(" · ") || "Sans client renseigné"}
            </div>
            <div className="text-xs text-muted-foreground">
              {[r.site_label, r.user_name].filter(Boolean).join(" · ")}
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
