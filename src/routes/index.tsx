import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, ScanLine, Search } from "lucide-react";

import { fetchRecentOrders, searchOrders } from "@/lib/queries";
import { formatPlate } from "@/lib/plate";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DDA Connect — Tour Véhicule" },
      {
        name: "description",
        content:
          "Accueil DDA Connect : créez un ordre de réparation, scannez une plaque et démarrez un tour véhicule.",
      },
      { property: "og:title", content: "DDA Connect — Tour Véhicule" },
      {
        property: "og:description",
        content: "Créez un OR, scannez une plaque et démarrez un tour véhicule atelier.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const [term, setTerm] = useState("");
  const recent = useQuery({ queryKey: ["recent-orders"], queryFn: fetchRecentOrders });
  const results = useQuery({
    queryKey: ["search-orders", term],
    queryFn: () => searchOrders(term),
    enabled: term.trim().length >= 2,
  });

  const list = term.trim().length >= 2 ? (results.data ?? []) : (recent.data ?? []);

  return (
    <div className="min-h-screen bg-background pb-16">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4">
          <div className="h-10 w-1.5 rounded-full bg-brand" aria-hidden />
          <div>
            <h1 className="text-xl font-extrabold uppercase tracking-tight">DDA Connect</h1>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Tour Véhicule
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

        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            {term.trim().length >= 2 ? "Résultats" : "OR récents"}
          </h2>
          <div className="space-y-2">
            {list.map((o) => {
              const v = o.vehicle as {
                plate?: string;
                brand?: string;
                model?: string;
              } | null;
              const c = o.client as { first_name?: string; last_name?: string } | null;
              return (
                <Link
                  key={o.id}
                  to="/or/$orId"
                  params={{ orId: o.id }}
                  className="card-surface block p-4 active:scale-[0.995]"
                >
                  <div className="plate-badge text-xl">{formatPlate(v?.plate ?? "")}</div>
                  <div className="text-sm font-medium text-foreground">
                    {[v?.brand, v?.model].filter(Boolean).join(" ") || "Véhicule"}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    <span>OR {o.or_number || "—"}</span>
                    <span>{o.or_date ? new Date(o.or_date).toLocaleDateString("fr-FR") : "—"}</span>
                    <span>{[c?.first_name, c?.last_name].filter(Boolean).join(" ") || "Client —"}</span>
                  </div>
                </Link>
              );
            })}
            {list.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                {term.trim().length >= 2 ? "Aucun résultat." : "Aucun OR pour le moment."}
              </p>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
