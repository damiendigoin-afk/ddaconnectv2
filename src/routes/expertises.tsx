import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Euro, FileSearch, Plus, SlidersHorizontal } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { euro, fetchRecentExpertises, STATUS_LABELS } from "@/lib/expertise";
import { formatPlate } from "@/lib/plate";

export const Route = createFileRoute("/expertises")({
  head: () => ({
    meta: [
      { title: "Expertise Véhicule — DDA Connect" },
      {
        name: "description",
        content:
          "Module Expertise Véhicule : état des lieux photo, dommages chiffrés et rapport professionnel envoyé au client.",
      },
      { property: "og:title", content: "Expertise Véhicule — DDA Connect" },
      {
        property: "og:description",
        content: "État des lieux photo guidé, dommages chiffrés et rapport d'expertise.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExpertiseHub,
});

function ExpertiseHub() {
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const list = useQuery({ queryKey: ["expertises"], queryFn: () => fetchRecentExpertises(20) });

  return (
    <AppShell
      title="Expertise Véhicule"
      subtitle="État des lieux photo et chiffrage"
      back={{ to: "/" }}
      right={
        isManager ? (
          <Link
            to="/expertise/bareme"
            aria-label="Barème de prix"
            className="rounded-lg border border-border p-2 text-muted-foreground"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Link>
        ) : null
      }
    >
      <button
        onClick={() => void navigate({ to: "/expertise/nouvelle" })}
        className="flex w-full items-center gap-3 rounded-xl bg-brand px-4 py-5 text-brand-foreground active:scale-[0.99]"
      >
        <Plus className="h-7 w-7" />
        <span className="flex-1 text-left text-lg font-extrabold uppercase tracking-wide">
          Nouvelle expertise
        </span>
      </button>

      <h2 className="px-1 pb-2 pt-6 text-sm font-extrabold uppercase tracking-wide">
        Expertises récentes
      </h2>
      {list.isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : list.data?.length ? (
        <ul className="space-y-2">
          {list.data.map((e) => (
            <li key={e.id}>
              <Link
                to={e.status === "draft" ? "/expertise/$exId" : "/expertise/$exId/rapport"}
                params={{ exId: e.id }}
                className="card-surface block p-4 active:scale-[0.995]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="plate-badge text-xl">{formatPlate(e.plate ?? "")}</div>
                    <div className="text-sm font-medium">
                      {[e.brand, e.model].filter(Boolean).join(" ") || "Véhicule"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(e.created_at).toLocaleDateString("fr-FR")} ·{" "}
                      {e.created_by_name || "—"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold uppercase text-muted-foreground">
                      {STATUS_LABELS[e.status] ?? e.status}
                    </div>
                    <div className="inline-flex items-center gap-1 text-sm font-extrabold">
                      <Euro className="h-3.5 w-3.5" /> {euro(e.cost)}
                    </div>
                    <div className="text-xs text-muted-foreground">{e.damages} dommage(s)</div>
                    {e.pending > 0 ? (
                      <div className="text-xs font-bold text-status-watch">
                        {e.pending} à chiffrer
                      </div>
                    ) : null}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="card-surface flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <FileSearch className="h-4 w-4" /> Aucune expertise pour le moment.
        </p>
      )}
    </AppShell>
  );
}