import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Camera,
  Wrench,
  ChevronRight,
  FileSpreadsheet,
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
import { useModuleAccess, usePermissions } from "@/lib/module-access";
import { countToValidate, countUnreadExpenseUpdates } from "@/lib/expenses";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DDA Connect — Accueil atelier" },
      {
        name: "description",
        content:
          "DDA Connect : recherche multi-sites, scan OR / plaque, atelier centré sur l’OR WinMotor, pièces & achats et notes de frais.",
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

/** Navigation V3 : Atelier d'abord, peu d'entrées, droits = accès au menu. */
type Entry = { to: string; label: string; hint: string; icon: LucideIcon; modules: string[] };
type Family = { title: string; entries: Entry[] };

const FAMILIES: Family[] = [
  {
    title: "Principal",
    entries: [
      { to: "/atelier", label: "Atelier", hint: "Scanner, OR WinMotor, Tour véhicule, devis pneus, expertise", icon: Wrench, modules: ["tour", "pneus", "expertise", "maintenance"] },
      { to: "/pieces-achats", label: "Pièces & achats", hint: "Commandes, réception, stock, factures fournisseur, retours et avoirs", icon: PackageOpen, modules: ["magasin"] },
      { to: "/notes-frais", label: "Notes de frais", hint: "Saisie, validation et suivi comptable", icon: FileSpreadsheet, modules: ["notes_frais"] },
    ],
  },
  {
    title: "Autres modules",
    entries: [
      { to: "/carrosserie", label: "Carrosserie", hint: "Missions, expert, pièces et planning", icon: Hammer, modules: ["carrosserie"] },
      { to: "/crm", label: "CRM", hint: "Appels, emails et réclamations", icon: Headphones, modules: ["crm"] },
      { to: "/recuperation", label: "Ventes", hint: "Récupérations, VN / VO et livraisons", icon: Truck, modules: ["recuperation"] },
      { to: "/communication", label: "Communication", hint: "Supports publicitaires et affichage", icon: Megaphone, modules: ["communication"] },
      { to: "/statistiques", label: "Statistiques", hint: "Productivité, tours et activité", icon: BarChart3, modules: ["statistiques"] },
      { to: "/pilotage", label: "Gestion", hint: "Objectifs, KPIs, balance âgée et relances", icon: TrendingUp, modules: ["pilotage"] },
      { to: "/parametrage", label: "Paramétrage", hint: "Utilisateurs, base de données, flux, santé", icon: SlidersHorizontal, modules: ["parametrage"] },
    ],
  },
];

function Hub() {
  const { user, isManager, displayName, signOut } = useAuth();
  const { can } = useModuleAccess();
  const perms = usePermissions();
  const missing = useQuery({
    queryKey: ["prod-missing"],
    queryFn: () => fetchMissingReports(),
    enabled: isManager,
  });
  // Pastille « À valider » sur Notes de frais, uniquement pour les valideurs.
  const toValidate = useQuery({
    queryKey: ["expenses", "to_validate", "count"],
    queryFn: countToValidate,
    enabled: perms.canValidateExpenses,
    staleTime: 30_000,
  });
  const expenseUpdates = useQuery({
    queryKey: ["expenses", "employee-updates", user?.id],
    queryFn: () => countUnreadExpenseUpdates(user?.id ?? ""),
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  const families = FAMILIES.map((f) => ({
    ...f,
    entries: f.entries.filter((m) => m.modules.some((k) => can(k as never))),
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
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <UniversalSearch />
          </div>
          {can("tour") ? (
            <Link
              to="/scan-plaque"
              aria-label="Scanner OR / plaque"
              title="Scanner OR / plaque"
              className="flex h-[60px] shrink-0 items-center gap-2 rounded-xl bg-brand px-4 text-brand-foreground shadow-sm"
            >
              <Camera className="h-6 w-6" />
              <span className="hidden text-xs font-extrabold uppercase leading-tight sm:block">Scanner<br />OR / plaque</span>
            </Link>
          ) : null}
        </div>

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

        {families.map((f) => (
          <section key={f.title} className="space-y-2 pt-2">
            <h2 className="px-1 text-xs font-extrabold uppercase tracking-widest text-muted-foreground">
              {f.title}
            </h2>
            {f.entries.map((m) => {
              const Icon = m.icon;
              const primary = m.to === "/atelier";
      const pending = m.to === "/notes-frais" ? (toValidate.data ?? 0) : 0;
      const updates = m.to === "/notes-frais" ? (expenseUpdates.data ?? 0) : 0;
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
                    <div className="flex items-center gap-2 text-base font-extrabold uppercase tracking-wide">
                      {m.label}
                      {pending ? (
                        <span className="rounded-full bg-status-watch px-2 py-0.5 text-[11px] font-bold text-white">
                          {pending} à valider
                        </span>
                      ) : null}
              {updates ? (
                <span className="rounded-full bg-status-ok px-2 py-0.5 text-[11px] font-bold text-white">
                  {updates} mise{updates > 1 ? "s" : ""} à jour
                </span>
              ) : null}
                    </div>
                    <div className={`text-xs ${primary ? "font-medium opacity-80" : "text-muted-foreground"}`}>
                      {m.hint}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0" />

                </Link>
              );
            })}
          </section>
        ))}

      </main>
    </div>
  );
}
