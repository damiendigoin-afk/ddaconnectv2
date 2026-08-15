import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Car, Lock } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DDA Connect — Plateforme atelier" },
      {
        name: "description",
        content:
          "DDA Connect : la plateforme atelier modulaire du garage. Accédez au module Tour Véhicule et aux prochains modules.",
      },
      { property: "og:title", content: "DDA Connect — Plateforme atelier" },
      {
        property: "og:description",
        content: "Plateforme atelier modulaire : Tour Véhicule et modules à venir.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Hub,
});

const SOON = [
  { title: "Réception client", desc: "Accueil, devis et validation" },
  { title: "Suivi atelier", desc: "Planning et avancement des OR" },
  { title: "Restitution", desc: "Contrôle final et remise du véhicule" },
];

function Hub() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-5">
          <div className="h-10 w-1.5 rounded-full bg-brand" aria-hidden />
          <div>
            <h1 className="text-xl font-extrabold uppercase tracking-tight">DDA Connect</h1>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Plateforme atelier
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-5">
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Modules
          </h2>
          <Link
            to="/tour-vehicule"
            className="flex items-center gap-4 rounded-xl bg-brand px-4 py-5 text-brand-foreground shadow-sm active:scale-[0.99]"
          >
            <Car className="h-8 w-8 shrink-0" />
            <div className="flex-1">
              <div className="text-lg font-extrabold uppercase tracking-wide">Tour Véhicule</div>
              <div className="text-xs font-medium opacity-80">
                OR, contrôle guidé ou libre, rapport et envoi client
              </div>
            </div>
            <ChevronRight className="h-6 w-6 shrink-0" />
          </Link>
        </section>

        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Prochainement
          </h2>
          <div className="space-y-2">
            {SOON.map((m) => (
              <div
                key={m.title}
                className="flex items-center gap-3 rounded-xl border border-dashed border-border px-4 py-4 text-muted-foreground"
              >
                <Lock className="h-5 w-5 shrink-0" />
                <div>
                  <div className="text-sm font-bold uppercase">{m.title}</div>
                  <div className="text-xs">{m.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
