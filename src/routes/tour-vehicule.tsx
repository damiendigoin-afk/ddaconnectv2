import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronLeft, Plus, ScanLine, Search } from "lucide-react";

import { OrCard } from "@/components/OrCard";
import { TourRow } from "@/components/RecentTours";
import { fetchRecentOrders, fetchRecentTours, searchOrders } from "@/lib/queries";

export const Route = createFileRoute("/tour-vehicule")({
  head: () => ({
    meta: [
      { title: "Tour Véhicule — DDA Connect" },
      {
        name: "description",
        content:
          "Module Tour Véhicule : créez un ordre de réparation, scannez une plaque et suivez les tours récents.",
      },
      { property: "og:title", content: "Tour Véhicule — DDA Connect" },
      {
        property: "og:description",
        content: "Créez un OR, scannez une plaque et démarrez un tour véhicule atelier.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ModuleHome,
});

function ModuleHome() {
  const [term, setTerm] = useState("");
  const recent = useQuery({ queryKey: ["recent-orders"], queryFn: fetchRecentOrders });
  const tours = useQuery({ queryKey: ["recent-tours"], queryFn: () => fetchRecentTours(8) });
  const results = useQuery({
    queryKey: ["search-orders", term],
    queryFn: () => searchOrders(term),
    enabled: term.trim().length >= 2,
  });

  const searching = term.trim().length >= 2;
  const list = searching ? (results.data ?? []) : (recent.data ?? []);

  return (
    <div className="min-h-screen bg-background pb-16">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4">
          <Link to="/" className="rounded-lg p-2 -ml-2" aria-label="Retour aux modules">
            <ChevronLeft className="h-6 w-6" />
          </Link>
          <div>
            <h1 className="text-xl font-extrabold uppercase tracking-tight">Tour Véhicule</h1>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              DDA Connect
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-5">
        <div className="grid gap-3">
          <Link
            to="/or/nouveau"
            search={{ plate: "" }}
            className="flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-5 text-lg font-extrabold uppercase tracking-wide text-brand-foreground shadow-sm active:scale-[0.99]"
          >
            <Plus className="h-6 w-6" /> Nouvel OR
          </Link>
          <Link
            to="/scan-plaque"
            className="flex items-center justify-center gap-2 rounded-xl border-2 border-primary bg-card px-4 py-4 text-base font-bold uppercase tracking-wide"
          >
            <ScanLine className="h-5 w-5" /> Scanner une plaque
          </Link>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Immatriculation, n° OR, client…"
            className="w-full rounded-xl border border-border bg-card py-4 pl-11 pr-4 text-base outline-none focus:border-brand"
          />
        </div>

        {!searching && (tours.data ?? []).length > 0 ? (
          <section>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Tours véhicule récents
            </h2>
            <div className="space-y-2">
              {(tours.data ?? []).map((t) => (
                <TourRow key={t.id} t={t} />
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            {searching ? "Résultats" : "OR récents"}
          </h2>
          <div className="space-y-2">
            {list.map((o) => (
              <OrCard key={o.id} o={o as never} />
            ))}
            {list.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                {searching ? "Aucun résultat." : "Aucun OR pour le moment."}
              </p>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
