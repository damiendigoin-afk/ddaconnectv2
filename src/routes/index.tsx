import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Car, ClipboardCheck, Database, Hammer, LogOut, PackageOpen, Users } from "lucide-react";

import { UniversalSearch } from "@/components/UniversalSearch";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DDA Connect — Accueil atelier" },
      {
        name: "description",
        content:
          "DDA Connect : accédez au module Tour Véhicule, aux ordres de réparation et aux rapports clients du garage.",
      },
      { property: "og:title", content: "DDA Connect — Accueil atelier" },
      {
        property: "og:description",
        content: "Module Tour Véhicule, ordres de réparation et rapports clients.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Hub,
});

function Hub() {
  const { isManager, displayName, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background pb-16">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-5">
          <div className="h-10 w-1.5 rounded-full bg-brand" aria-hidden />
          <h1 className="flex-1 text-2xl font-extrabold tracking-tight">
            DDA <span className="text-brand">Connect</span>
          </h1>
          <div className="flex items-center gap-2">
            {displayName ? (
              <span className="hidden text-xs text-muted-foreground sm:block">{displayName}</span>
            ) : null}
            <button
              onClick={() => void signOut()}
              aria-label="Se déconnecter"
              className="rounded-lg border border-border p-2 text-muted-foreground"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-4 py-5">
        <UniversalSearch />

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

        <Link
          to="/expertises"
          className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-5 active:scale-[0.99]"
        >
          <ClipboardCheck className="h-8 w-8 shrink-0 text-brand" />
          <div className="flex-1">
            <div className="text-lg font-extrabold uppercase tracking-wide">Expertise Véhicule</div>
            <div className="text-xs text-muted-foreground">
              État des lieux photo, dommages chiffrés et rapport client
            </div>
          </div>
          <ChevronRight className="h-6 w-6 shrink-0" />
        </Link>

        {isManager ? (
          <Link
            to="/base"
            className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]"
          >
            <Database className="h-6 w-6 shrink-0 text-brand" />
            <div className="flex-1">
              <div className="text-base font-extrabold uppercase tracking-wide">Base de données</div>
              <div className="text-xs text-muted-foreground">
                Import Winmotor, clients, véhicules et historique des imports
              </div>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0" />
          </Link>
        ) : null}

        {isManager ? (
          <Link
            to="/utilisateurs"
            className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]"
          >
            <Users className="h-6 w-6 shrink-0" />
            <div className="flex-1">
              <div className="text-base font-extrabold uppercase tracking-wide">Utilisateurs</div>
              <div className="text-xs text-muted-foreground">Valider les comptes et gérer les rôles</div>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0" />
          </Link>
        ) : null}
      </main>
    </div>
  );
}
