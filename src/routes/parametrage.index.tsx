import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  Bot,
  BookOpen,
  ChevronRight,
  Database,
  Inbox,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/parametrage/")({
  head: () => ({
    meta: [
      { title: "Paramétrage — DDA Connect" },
      {
        name: "description",
        content:
          "Paramétrage DDA Connect : utilisateurs, base de données, flux emails, base de connaissances, qualité des données, automatisations, santé plateforme et référentiels partagés.",
      },
      { property: "og:title", content: "Paramétrage — DDA Connect" },
      { property: "og:description", content: "Toutes les fonctions techniques et administratives de DDA Connect." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Settings,
});

const ENTRIES: { to: string; label: string; hint: string; icon: LucideIcon }[] = [
  {
    to: "/utilisateurs",
    label: "Utilisateurs",
    hint: "Validation des comptes, rôles, droits par module, site par défaut et connexions Gmail",
    icon: Users,
  },
  {
    to: "/base",
    label: "Base de données",
    hint: "Imports Winmotor, clients, véhicules, historique et contrôle des sources",
    icon: Database,
  },
  {
    to: "/emails",
    label: "Flux emails",
    hint: "Boîtes Gmail, collecte, qualification automatique, anti-doublons et pièces jointes",
    icon: Inbox,
  },
  {
    to: "/connaissances",
    label: "Base de connaissances",
    hint: "Procédures, forfaits, temps barémés, garanties, agréments et règles métier versionnées",
    icon: BookOpen,
  },
  {
    to: "/qualite",
    label: "Qualité des données",
    hint: "Doublons, fusions, documents à classer, complétude et historique des modifications",
    icon: ShieldCheck,
  },
  {
    to: "/automatisations",
    label: "Automatisations",
    hint: "RPA, scénarios planifiés, exports nocturnes, purges, reprise sur erreur et exécutions",
    icon: Bot,
  },
  {
    to: "/parametrage/sante",
    label: "Santé plateforme",
    hint: "Stockage, base de données, emails envoyés, quotas, erreurs et alertes",
    icon: Activity,
  },
  {
    to: "/parametrage/global",
    label: "Paramétrage global",
    hint: "Fournisseurs, contacts, référentiels partagés et modèles de messages",
    icon: SlidersHorizontal,
  },
];

function Settings() {
  const { isManager } = useAuth();

  return (
    <AppShell title="Paramétrage" subtitle="Administration et référentiels" back={{ to: "/" }}>
      {!isManager ? (
        <p className="rounded-lg bg-amber-100 px-3 py-3 text-sm text-amber-950">Accès réservé aux managers.</p>
      ) : (
        <div className="space-y-3 pt-2">
          {ENTRIES.map((e) => {
            const Icon = e.icon;
            return (
              <Link
                key={e.to}
                to={e.to}
                className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]"
              >
                <Icon className="h-6 w-6 shrink-0 text-brand" />
                <div className="flex-1">
                  <div className="text-base font-extrabold uppercase tracking-wide">{e.label}</div>
                  <div className="text-xs text-muted-foreground">{e.hint}</div>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0" />
              </Link>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
