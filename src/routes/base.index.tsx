import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Car, Database, History, Upload, User } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { UniversalSearch } from "@/components/UniversalSearch";
import { useAuth } from "@/lib/auth";
import { countRef } from "@/lib/refbase";

export const Route = createFileRoute("/base/")({
  head: () => ({
    meta: [
      { title: "Base de données — DDA Connect" },
      { name: "description", content: "Référentiel clients et véhicules DDA Connect : import Winmotor, recherche et historique des imports." },
      { property: "og:title", content: "Base de données — DDA Connect" },
      { property: "og:description", content: "Import Winmotor, référentiel clients et véhicules." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BaseHub,
});

function BaseHub() {
  const { isManager } = useAuth();
  const { data } = useQuery({ queryKey: ["ref-count"], queryFn: countRef });

  if (!isManager) {
    return (
      <AppShell title="Base de données" back={{ to: "/" }}>
        <p className="card-surface p-5 text-sm text-muted-foreground">
          Ce module est réservé aux managers. Utilisez la recherche depuis l'accueil pour retrouver un client ou un véhicule.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Base de données" subtitle="Référentiel clients & véhicules" back={{ to: "/" }}>
      <div className="space-y-4">
        <UniversalSearch />

        <div className="grid grid-cols-2 gap-3">
          <Link to="/base/clients" className="card-surface p-4 active:scale-[0.99]">
            <div className="text-xs uppercase text-muted-foreground">Clients</div>
            <div className="text-2xl font-extrabold">{(data?.customers ?? 0).toLocaleString("fr-FR")}</div>
            <div className="text-[11px] font-bold uppercase text-brand">Voir la liste</div>
          </Link>
          <Link to="/base/vehicules" className="card-surface p-4 active:scale-[0.99]">
            <div className="text-xs uppercase text-muted-foreground">Véhicules</div>
            <div className="text-2xl font-extrabold">{(data?.vehicles ?? 0).toLocaleString("fr-FR")}</div>
            <div className="text-[11px] font-bold uppercase text-brand">Voir la liste</div>
          </Link>
        </div>

        <Link
          to="/base/import"
          className="flex items-center gap-4 rounded-xl bg-brand px-4 py-5 text-brand-foreground active:scale-[0.99]"
        >
          <Upload className="h-7 w-7 shrink-0" />
          <div className="flex-1">
            <div className="text-base font-extrabold uppercase tracking-wide">Importer une base Winmotor</div>
            <div className="text-xs opacity-80">CSV (;) ou XLSX — analyse avant import</div>
          </div>
          <ChevronRight className="h-6 w-6" />
        </Link>

        <Tile to="/base/clients" icon={<User className="h-5 w-5 text-brand" />} title="Clients" desc="Rechercher et consulter les fiches clients" />
        <Tile to="/base/vehicules" icon={<Car className="h-5 w-5 text-brand" />} title="Véhicules" desc="Parc véhicules du référentiel" />
        <Tile to="/base/historique" icon={<History className="h-5 w-5 text-brand" />} title="Historique des imports" desc="Fichiers importés, compteurs et anomalies" />
        <div className="flex items-center gap-2 px-1 pt-2 text-xs text-muted-foreground">
          <Database className="h-3.5 w-3.5" /> Les lignes source Winmotor sont conservées intégralement.
        </div>
      </div>
    </AppShell>
  );
}

function Tile({ to, icon, title, desc }: { to: string; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Link to={to} className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]">
      {icon}
      <div className="flex-1">
        <div className="text-base font-extrabold uppercase tracking-wide">{title}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <ChevronRight className="h-5 w-5" />
    </Link>
  );
}
