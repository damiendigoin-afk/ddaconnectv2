import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Truck, Building2 } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/parametrage/")({
  head: () => ({
    meta: [
      { title: "Paramétrage global — DDA Connect" },
      { name: "description", content: "Réglages transverses de DDA Connect : référentiel fournisseurs et contacts partagés par tous les modules." },
      { property: "og:title", content: "Paramétrage global — DDA Connect" },
      { property: "og:description", content: "Référentiel fournisseurs global et contacts partagés." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Settings,
});

function Settings() {
  const { isManager } = useAuth();

  return (
    <AppShell title="Paramétrage global" subtitle="Référentiels partagés" back={{ to: "/" }}>
      {!isManager ? (
        <p className="rounded-lg bg-amber-100 px-3 py-3 text-sm text-amber-950">Accès réservé aux managers.</p>
      ) : (
        <div className="space-y-3 pt-2">
          <Link to="/parametrage/fournisseurs" className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]">
            <Truck className="h-6 w-6 shrink-0 text-brand" />
            <div className="flex-1">
              <div className="text-base font-extrabold uppercase tracking-wide">Fournisseurs</div>
              <div className="text-xs text-muted-foreground">Référentiel unique et contacts (magasin PR, retours, commercial…)</div>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0" />
          </Link>
          <Link to="/carrosserie/referentiels" className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]">
            <Building2 className="h-6 w-6 shrink-0 text-brand" />
            <div className="flex-1">
              <div className="text-base font-extrabold uppercase tracking-wide">Assurances & experts</div>
              <div className="text-xs text-muted-foreground">Assurances, cabinets, experts et agréments</div>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0" />
          </Link>
        </div>
      )}
    </AppShell>
  );
}
