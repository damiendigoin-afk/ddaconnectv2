import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ChevronLeft, Plus, ScanLine } from "lucide-react";

import { EntitySearch, type EntityPick } from "@/components/EntitySearch";
import { OrCard } from "@/components/OrCard";
import { TourRow } from "@/components/RecentTours";
import { fetchRecentOrders, fetchRecentTours } from "@/lib/queries";
import { refPrefillByVehicle } from "@/lib/refbase";

export const Route = createFileRoute("/tour-vehicule")({
  validateSearch: (search: Record<string, unknown>): { vehicle_id?: string } =>
    typeof search["vehicle_id"] === "string" && search["vehicle_id"]
      ? { vehicle_id: search["vehicle_id"] as string }
      : {},
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

const MAX = 5;

function ModuleHome() {
  const navigate = useNavigate();
  const { vehicle_id: vehicleIdParam } = Route.useSearch();
  const [tab, setTab] = useState<"tours" | "ors">("tours");

  // Le véhicule choisi sur une fiche suit l'utilisateur : aucune ressaisie.
  useEffect(() => {
    if (!vehicleIdParam) return;
    let alive = true;
    void refPrefillByVehicle(vehicleIdParam).then((p) => {
      if (!alive || !p) return;
      navigate({ to: "/or/nouveau", search: { plate: p.fields["plate"] ?? "" } });
    });
    return () => {
      alive = false;
    };
  }, [vehicleIdParam, navigate]);
  const recent = useQuery({ queryKey: ["recent-orders"], queryFn: () => fetchRecentOrders() });
  const tours = useQuery({
    queryKey: ["recent-tours", "completed"],
    queryFn: () => fetchRecentTours(MAX, "completed"),
  });
  const drafts = useQuery({
    queryKey: ["recent-tours", "open"],
    queryFn: () => fetchRecentTours(MAX, "open"),
  });

  function onPick(pick: EntityPick) {
    if (pick.orderId) {
      navigate({ to: "/or/$orId", params: { orId: pick.orderId } });
      return;
    }
    navigate({ to: "/or/nouveau", search: { plate: pick.fields["plate"] ?? "" } });
  }

  const orders = (recent.data ?? []).slice(0, MAX);
  const tourList = (tours.data ?? []).slice(0, MAX);
  const draftList = (drafts.data ?? []).slice(0, MAX);

  const draftsCol = (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Brouillons / tours en cours
        </h2>
        <Link to="/tours" className="text-xs font-bold uppercase tracking-widest text-brand">
          Tout voir
        </Link>
      </div>
      <div className="space-y-2">
        {draftList.map((t) => (
          <TourRow key={t.id} t={t} resume />
        ))}
        {draftList.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Aucun tour en cours.
          </p>
        ) : null}
      </div>
    </section>
  );

  const toursCol = (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Tours Véhicule clôturés
        </h2>
        <Link to="/tours" className="text-xs font-bold uppercase tracking-widest text-brand">
          Voir tous les Tours
        </Link>
      </div>
      <div className="space-y-2">
        {tourList.map((t) => (
          <TourRow key={t.id} t={t} />
        ))}
        {tourList.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Aucun tour véhicule pour le moment.
          </p>
        ) : null}
      </div>
    </section>
  );

  const ordersCol = (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          OR récents
        </h2>
        <Link to="/ordres" className="text-xs font-bold uppercase tracking-widest text-brand">
          Voir tous les OR
        </Link>
      </div>
      <div className="space-y-2">
        {orders.map((o) => (
          <OrCard key={o.id} o={o as never} />
        ))}
        {orders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Aucun OR pour le moment.
          </p>
        ) : null}
      </div>
    </section>
  );

  return (
    <div className="min-h-screen bg-background pb-16">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4">
          <Link to="/" className="-ml-2 rounded-lg p-2" aria-label="Retour aux modules">
            <ChevronLeft className="h-6 w-6" />
          </Link>
          <div>
            <h1 className="text-xl font-extrabold uppercase tracking-tight">Tour Véhicule</h1>
            <p className="text-xs font-medium tracking-widest text-muted-foreground">
              DDA Connect
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-5">
        <div className="grid gap-3 sm:grid-cols-2">
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

        <EntitySearch onPick={onPick} />

        <>
            {/* Mobile : sélecteur simple entre les deux listes */}
            <div className="lg:hidden">
              <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl bg-secondary p-1">
                <button
                  onClick={() => setTab("tours")}
                  className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-widest ${tab === "tours" ? "bg-card shadow-sm" : "text-muted-foreground"}`}
                >
                  Tours récents
                </button>
                <button
                  onClick={() => setTab("ors")}
                  className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-widest ${tab === "ors" ? "bg-card shadow-sm" : "text-muted-foreground"}`}
                >
                  OR récents
                </button>
              </div>
              {tab === "tours" ? toursCol : ordersCol}
            </div>

            {/* Desktop / tablette large : deux colonnes */}
            <div className="hidden gap-6 lg:grid lg:grid-cols-2 lg:items-start">
              {toursCol}
              {ordersCol}
            </div>
        </>
      </main>
    </div>
  );
}
