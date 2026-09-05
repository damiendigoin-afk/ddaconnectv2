import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, ChevronRight, Euro, MessageSquareText, Plug, Truck } from "lucide-react";

import { AppShell } from "@/components/AppShell";

import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/parametrage/global")({
  head: () => ({
    meta: [
      { title: "Paramétrage global — DDA Connect" },
      {
        name: "description",
        content:
          "Référentiels partagés DDA Connect : fournisseurs et contacts, assurances et experts, modèles de messages administrables.",
      },
      { property: "og:title", content: "Paramétrage global — DDA Connect" },
      { property: "og:description", content: "Fournisseurs, contacts, référentiels et modèles de messages." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GlobalSettings,
});




function GlobalSettings() {
  const { isManager } = useAuth();



  if (!isManager) {
    return (
      <AppShell title="Paramétrage global" back={{ to: "/parametrage" }}>
        <p className="rounded-lg bg-amber-100 px-3 py-3 text-sm text-amber-950">Accès réservé aux managers.</p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Paramétrage global" subtitle="Référentiels partagés" back={{ to: "/parametrage" }}>
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
        <Link to="/parametrage/tarifs" className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]">
          <Euro className="h-6 w-6 shrink-0 text-brand" />
          <div className="flex-1">
            <div className="text-base font-extrabold uppercase tracking-wide">Tarifs atelier</div>
            <div className="text-xs text-muted-foreground">Taux horaires, ingrédients peinture (IGP) et forfaits du garage</div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0" />
        </Link>
        <Link to="/parametrage/chiffrage" className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]">
          <Euro className="h-6 w-6 shrink-0 text-brand" />
          <div className="flex-1">
            <div className="text-base font-extrabold uppercase tracking-wide">Chiffrage & pneumatiques</div>
            <div className="text-xs text-muted-foreground">
              Marge commerciale, forfaits mécaniques, règles peinture et tarifs pneus
            </div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0" />
        </Link>
        <Link to="/parametrage/messages" className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]">
          <MessageSquareText className="h-6 w-6 shrink-0 text-brand" />
          <div className="flex-1">
            <div className="text-base font-extrabold uppercase tracking-wide">Modèles de messages</div>
            <div className="text-xs text-muted-foreground">Textes préremplis des communications expert et client</div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0" />
        </Link>

        <Link to="/parametrage/api" className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]">
          <Plug className="h-6 w-6 shrink-0 text-brand" />
          <div className="flex-1">
            <div className="text-base font-extrabold uppercase tracking-wide">Connexions externes</div>
            <div className="text-xs text-muted-foreground">
              IXELLIO, e-mails, OCR, stockage et comptes de communication : tout se règle dans Paramètres API
            </div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0" />
        </Link>

      </div>
    </AppShell>
  );
}
