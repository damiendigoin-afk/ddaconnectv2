import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { TourRow } from "@/components/RecentTours";
import { fetchRecentTours, type TourScope } from "@/lib/queries";

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

const SCOPES: { key: TourScope; label: string }[] = [
  { key: "completed", label: "Clôturés" },
  { key: "open", label: "En cours" },
  { key: "archived", label: "Archivés" },
  { key: "all", label: "Tous" },
];

const SUBTITLE: Record<TourScope, string> = {
  completed: "Derniers Tours clôturés",
  open: "Tours en cours / brouillons",
  archived: "Tours archivés",
  all: "Tous les Tours",
};

function AllTours() {
  const [scope, setScope] = useState<TourScope>("completed");
  const [text, setText] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState({ text: "", from: "", to: "" });

  const search = useMemo(
    () => ({
      text: applied.text,
      from: applied.from ? new Date(`${applied.from}T00:00:00`).toISOString() : null,
      to: applied.to ? new Date(`${applied.to}T23:59:59`).toISOString() : null,
    }),
    [applied],
  );

  // La recherche interroge toute la base, pas seulement les tours déjà affichés.
  const tours = useQuery({
    queryKey: ["all-tours", scope, search],
    queryFn: () => fetchRecentTours(200, scope, search),
  });

  return (
    <AppShell title="Tours véhicule" subtitle={SUBTITLE[scope]} back={{ to: "/tour-vehicule" }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ text, from, to });
        }}
        className="mb-3 space-y-2"
      >
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Immatriculation, n° OR, réf. DDA, client, marque, opérateur…"
            aria-label="Rechercher un tour véhicule"
            className="w-full rounded-lg border-2 border-border bg-card px-3 py-3 text-base outline-none focus:border-brand"
          />
          <button
            type="submit"
            aria-label="Rechercher"
            className="flex items-center gap-2 rounded-lg bg-brand px-4 text-sm font-bold uppercase text-brand-foreground"
          >
            <Search className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Du
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 w-full rounded-lg border-2 border-border bg-card px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Au
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 w-full rounded-lg border-2 border-border bg-card px-3 py-2 text-sm"
            />
          </label>
        </div>
        {applied.text || applied.from || applied.to ? (
          <button
            type="button"
            onClick={() => {
              setText("");
              setFrom("");
              setTo("");
              setApplied({ text: "", from: "", to: "" });
            }}
            className="text-xs font-bold uppercase tracking-widest text-brand underline"
          >
            Réinitialiser la recherche
          </button>
        ) : null}
      </form>

      <div className="mb-3 grid grid-cols-4 gap-1 rounded-xl bg-secondary p-1">
        {SCOPES.map((s) => (
          <button
            key={s.key}
            onClick={() => setScope(s.key)}
            className={`rounded-lg px-2 py-2 text-[11px] font-bold uppercase tracking-widest ${
              scope === s.key ? "bg-card shadow-sm" : "text-muted-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {tours.isLoading ? <p className="text-sm text-muted-foreground">Recherche…</p> : null}
        {(tours.data ?? []).map((t) => (
          <TourRow key={t.id} t={t} resume={t.status !== "completed"} />
        ))}
        {tours.data?.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Aucun tour ne correspond à cette recherche.
          </p>
        ) : null}
      </div>
    </AppShell>
  );
}
