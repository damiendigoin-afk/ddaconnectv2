import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ChevronLeft, Plus } from "lucide-react";
import { toast } from "sonner";

import { DocIdentify, type DocIdentifyResult } from "@/components/DocIdentify";
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
          "Module Tour Véhicule : créez une intervention, scannez une plaque et suivez les tours récents.",
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
  const [tab, setTab] = useState<"tours" | "drafts" | "ors">("tours");

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

  /** Identification unique par document : plaque, carte grise, OR, avis de sinistre… */
  function onDocument(r: DocIdentifyResult) {
    const plate = r.prefill?.fields["plate"] ?? r.extracted.plate ?? "";
    if (!plate) {
      toast.error("Aucune immatriculation lue sur ce document : saisis-la dans la nouvelle intervention.");
    }
    navigate({ to: "/or/nouveau", search: { plate } });
  }

  const orders = (recent.data ?? []).slice(0, MAX);
  const tourList = (tours.data ?? []).slice(0, MAX);
  const draftList = (drafts.data ?? []).slice(0, MAX);

  const draftsCol = (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Tours en cours
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
          Derniers Tours clôturés
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
          Interventions récentes
        </h2>
        <Link to="/ordres" className="text-xs font-bold uppercase tracking-widest text-brand">
          Voir toutes
        </Link>
      </div>
      <div className="space-y-2">
        {orders.map((o) => (
          <OrCard key={o.id} o={o as never} />
        ))}
        {orders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Aucune intervention pour le moment.
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
            <p className="text-xs font-medium tracking-widest text-muted-foreground">DDA Connect</p>
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
            <Plus className="h-6 w-6" /> Nouvelle intervention
          </Link>
          <DocIdentify compact={false} onResult={onDocument} onError={(m) => toast.error(m)} />
        </div>

        <EntitySearch
          onPick={onPick}
          onDocument={onDocument}
          onDocumentError={(m) => toast.error(m)}
        />

        <>
          {/* Mobile : sélecteur simple entre les deux listes */}
          <div className="lg:hidden">
            <div className="mb-3 grid grid-cols-3 gap-2 rounded-xl bg-secondary p-1">
              <button
                onClick={() => setTab("tours")}
                className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-widest ${tab === "tours" ? "bg-card shadow-sm" : "text-muted-foreground"}`}
              >
                Clôturés
              </button>
              <button
                onClick={() => setTab("drafts")}
                className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-widest ${tab === "drafts" ? "bg-card shadow-sm" : "text-muted-foreground"}`}
              >
                Brouillons
              </button>
              <button
                onClick={() => setTab("ors")}
                className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-widest ${tab === "ors" ? "bg-card shadow-sm" : "text-muted-foreground"}`}
              >
                Interventions récentes
              </button>
            </div>
            {tab === "tours" ? toursCol : tab === "drafts" ? draftsCol : ordersCol}
          </div>

          {/* Desktop / tablette large : deux colonnes */}
          <div className="hidden gap-6 lg:grid lg:grid-cols-2 lg:items-start">
            <div className="space-y-6">
              {toursCol}
              {draftsCol}
            </div>
            {ordersCol}
          </div>
        </>
      </main>
    </div>
  );
}
