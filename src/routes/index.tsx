import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  ChevronRight,
  Car,
  ClipboardCheck,
  FileSpreadsheet,
  Gauge,
  Hammer,
  Headphones,
  Megaphone,
  LogOut,
  PackageOpen,
  SlidersHorizontal,
  Truck,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { UniversalSearch } from "@/components/UniversalSearch";
import { useAuth } from "@/lib/auth";
import { fetchMissingReports, periodLabel } from "@/lib/stats";
import { useModuleAccess } from "@/lib/module-access";

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

/** Arborescence par familles d'usage : les routes et les droits sont inchangés. */
type Entry = { to: string; label: string; hint: string; icon: LucideIcon; module?: string; managerOnly?: boolean };
type Family = { title: string; entries: Entry[] };

const FAMILIES: Family[] = [
  {
    title: "Atelier",
    entries: [
      {
        to: "/tour-vehicule",
        label: "Tour Véhicule",
        hint: "OR, contrôle guidé ou libre, rapport et envoi client",
        icon: Car,
        module: "tour",
      },
      {
        to: "/expertises",
        label: "Expertise Véhicule",
        hint: "État des lieux photo, dommages chiffrés et rapport client",
        icon: ClipboardCheck,
        module: "expertise",
      },
      {
        to: "/carrosserie",
        label: "Carrosserie",
        hint: "Missions, communication expert, pièces, planning et paiements",
        icon: Hammer,
        module: "carrosserie",
      },
      {
        to: "/maintenance",
        label: "Maintenance prédictive",
        hint: "Échéances projetées à partir des kilométrages relevés",
        icon: Gauge,
        module: "maintenance",
      },
    ],
  },
  {
    title: "Magasin & achats",
    entries: [
      {
        to: "/magasin",
        label: "Magasin",
        hint: "Retours de pièces, expéditions fournisseurs et avoirs",
        icon: PackageOpen,
        module: "magasin",
      },
      {
        to: "/factures-fournisseur",
        label: "BL & factures fournisseur",
        hint: "Dépôt photo ou PDF, lecture automatique, validation et rattachement OR",
        icon: FileSpreadsheet,
        module: "magasin",
      },
    ],
  },
  {
    title: "Clients & commercial",
    entries: [
      {
        to: "/crm",
        label: "CRM",
        hint: "Appels, emails et réclamations avec relance et escalade",
        icon: Headphones,
        module: "crm",
      },
      {
        to: "/recuperation",
        label: "Ventes",
        hint: "Planning et checklists de récupération, VN / VO et livraisons",
        icon: Truck,
        module: "recuperation",
      },
    ],
  },
  {
    title: "Communication",
    entries: [
      {
        to: "/communication",
        label: "Communication",
        hint: "Bibliothèque des supports publicitaires Renault / Dacia et rotation d'affichage",
        icon: Megaphone,
        module: "communication",
      },
    ],
  },
  {
    title: "Équipe & RH",
    entries: [
      {
        to: "/notes-frais",
        label: "Notes de frais",
        hint: "Saisie des dépenses, justificatifs et validation manager",
        icon: FileSpreadsheet,
        module: "notes_frais",
      },
    ],
  },
  {
    title: "Statistiques & pilotage",
    entries: [
      {
        to: "/statistiques",
        label: "Mes statistiques",
        hint: "Productivité, rentabilité et activité du mois",
        icon: BarChart3,
      },
      {
        to: "/pilotage",
        label: "Gestion",
        hint: "Objectifs, KPIs Groupe N/N-1/N-2, balance âgée, impayés et relances",
        icon: TrendingUp,
        module: "pilotage",
      },
    ],
  },
  {
    title: "Paramétrage",
    entries: [
      {
        to: "/parametrage",
        label: "Paramétrage",
        hint: "Utilisateurs, base de données, flux emails, connaissances, qualité, automatisations, santé",
        icon: SlidersHorizontal,
        managerOnly: true,
      },
    ],
  },
];

function Hub() {
  const { isManager, displayName, signOut } = useAuth();
  const { can } = useModuleAccess();
  const missing = useQuery({
    queryKey: ["prod-missing"],
    queryFn: () => fetchMissingReports(),
    enabled: isManager,
  });

  const families = FAMILIES.map((f) => ({
    ...f,
    entries: f.entries.filter((m) => (m.managerOnly ? isManager : can(m.module as never))),
  })).filter((f) => f.entries.length);

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

      <main className="mx-auto max-w-4xl space-y-3 px-4 py-5">
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

        {visible.map((m, i) => {
          const Icon = m.icon;
          const primary = i === 0 && m.to === "/tour-vehicule";
          return (
            <Link
              key={m.to}
              to={m.to}
              className={`flex items-center gap-4 rounded-xl px-4 py-4 active:scale-[0.99] ${
                primary
                  ? "bg-brand py-5 text-brand-foreground shadow-sm"
                  : "border-2 border-border bg-card"
              }`}
            >
              <Icon className={`h-7 w-7 shrink-0 ${primary ? "" : "text-brand"}`} />
              <div className="flex-1">
                <div className="text-base font-extrabold uppercase tracking-wide">{m.label}</div>
                <div className={`text-xs ${primary ? "font-medium opacity-80" : "text-muted-foreground"}`}>
                  {m.hint}
                </div>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0" />
            </Link>
          );
        })}
      </main>
    </div>
  );
}
