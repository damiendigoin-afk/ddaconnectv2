import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  BookOpen,
  Bot,
  ChevronRight,
  Car,
  ClipboardCheck,
  Database,
  FileSpreadsheet,
  Gauge,
  Hammer,
  Inbox,
  Headphones,
  LogOut,
  PackageOpen,
  ShieldCheck,
  Truck,
  Users,
  SlidersHorizontal,
} from "lucide-react";

import { UniversalSearch } from "@/components/UniversalSearch";
import { useAuth } from "@/lib/auth";
import { fetchMissingReports, periodLabel } from "@/lib/stats";

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
  const missing = useQuery({
    queryKey: ["prod-missing"],
    queryFn: () => fetchMissingReports(),
    enabled: isManager,
  });

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

        {isManager && (missing.data ?? []).length ? (
          <Link
            to="/statistiques/import"
            className="block rounded-xl border-2 border-status-watch bg-status-watch-soft px-4 py-4"
          >
            <div className="text-sm font-extrabold uppercase text-status-watch">
              ⚠ Productivité {periodLabel((missing.data ?? [])[0]!.periodStart)} à importer
            </div>
            <div className="text-xs text-muted-foreground">
              {(missing.data ?? []).map((m) => m.siteLabel).join(" · ")} — importer le rapport Winmotor mensuel
            </div>
          </Link>
        ) : null}

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

        <Link
          to="/carrosserie"
          className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-5 active:scale-[0.99]"
        >
          <Hammer className="h-8 w-8 shrink-0 text-brand" />
          <div className="flex-1">
            <div className="text-lg font-extrabold uppercase tracking-wide">Carrosserie</div>
            <div className="text-xs text-muted-foreground">
              Missions, experts, pièces, planning et suivi des paiements
            </div>
          </div>
          <ChevronRight className="h-6 w-6 shrink-0" />
        </Link>

        <Link
          to="/magasin"
          className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-5 active:scale-[0.99]"
        >
          <PackageOpen className="h-8 w-8 shrink-0 text-brand" />
          <div className="flex-1">
            <div className="text-lg font-extrabold uppercase tracking-wide">Magasin</div>
            <div className="text-xs text-muted-foreground">
              Retours de pièces, expéditions fournisseurs et avoirs
            </div>
          </div>
          <ChevronRight className="h-6 w-6 shrink-0" />
        </Link>

        <Link
          to="/statistiques"
          className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]"
        >
          <BarChart3 className="h-6 w-6 shrink-0 text-brand" />
          <div className="flex-1">
            <div className="text-base font-extrabold uppercase tracking-wide">Mes statistiques</div>
            <div className="text-xs text-muted-foreground">Productivité, rentabilité et activité du mois</div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0" />
        </Link>

        <Link
          to="/emails"
          className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]"
        >
          <Inbox className="h-6 w-6 shrink-0 text-brand" />
          <div className="flex-1">
            <div className="text-base font-extrabold uppercase tracking-wide">Flux emails</div>
            <div className="text-xs text-muted-foreground">
              Boîtes centralisées, classement automatique et anti-doublons
            </div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0" />
        </Link>

        <Link
          to="/darva"
          className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]"
        >
          <ShieldCheck className="h-6 w-6 shrink-0 text-brand" />
          <div className="flex-1">
            <div className="text-base font-extrabold uppercase tracking-wide">Gestion DARVA</div>
            <div className="text-xs text-muted-foreground">Missions, accords, factures et règlements assureurs</div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0" />
        </Link>

        <Link
          to="/maintenance"
          className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]"
        >
          <Gauge className="h-6 w-6 shrink-0 text-brand" />
          <div className="flex-1">
            <div className="text-base font-extrabold uppercase tracking-wide">Maintenance prédictive</div>
            <div className="text-xs text-muted-foreground">Échéances projetées à partir des kilométrages relevés</div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0" />
        </Link>

        <Link
          to="/recuperation"
          className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]"
        >
          <Truck className="h-6 w-6 shrink-0 text-brand" />
          <div className="flex-1">
            <div className="text-base font-extrabold uppercase tracking-wide">Récupération / VN / VO</div>
            <div className="text-xs text-muted-foreground">Planning et checklists de récupération et de livraison</div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0" />
        </Link>

        <Link
          to="/notes-frais"
          className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]"
        >
          <FileSpreadsheet className="h-6 w-6 shrink-0 text-brand" />
          <div className="flex-1">
            <div className="text-base font-extrabold uppercase tracking-wide">Notes de frais</div>
            <div className="text-xs text-muted-foreground">Saisie des dépenses, justificatifs et validation manager</div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0" />
        </Link>

        <Link
          to="/crm"
          className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]"
        >
          <Headphones className="h-6 w-6 shrink-0 text-brand" />
          <div className="flex-1">
            <div className="text-base font-extrabold uppercase tracking-wide">CRM demandes clients</div>
            <div className="text-xs text-muted-foreground">Appels, emails et réclamations avec relance et escalade</div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0" />
        </Link>

        <Link
          to="/qualite"
          className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]"
        >
          <Inbox className="h-6 w-6 shrink-0 text-brand" />
          <div className="flex-1">
            <div className="text-base font-extrabold uppercase tracking-wide">Qualité des données</div>
            <div className="text-xs text-muted-foreground">Doublons clients/véhicules, fusions et documents à classer</div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0" />
        </Link>

        <Link
          to="/connaissances"
          className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]"
        >
          <BookOpen className="h-6 w-6 shrink-0 text-brand" />
          <div className="flex-1">
            <div className="text-base font-extrabold uppercase tracking-wide">Base de connaissances</div>
            <div className="text-xs text-muted-foreground">Procédures, modes opératoires et astuces partagées</div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0" />
        </Link>

        {isManager ? (
          <Link
            to="/automatisations"
            className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]"
          >
            <Bot className="h-6 w-6 shrink-0" />
            <div className="flex-1">
              <div className="text-base font-extrabold uppercase tracking-wide">Automatisations</div>
              <div className="text-xs text-muted-foreground">Purges, détection d'échéances et relève des boîtes mail</div>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0" />
          </Link>
        ) : null}

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
            to="/parametrage"
            className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]"
          >
            <SlidersHorizontal className="h-6 w-6 shrink-0" />
            <div className="flex-1">
              <div className="text-base font-extrabold uppercase tracking-wide">Paramétrage global</div>
              <div className="text-xs text-muted-foreground">Fournisseurs, contacts et référentiels partagés</div>
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
