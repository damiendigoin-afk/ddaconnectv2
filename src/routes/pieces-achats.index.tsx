import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ClipboardList, FileCheck2, FileSpreadsheet, History, Inbox, PackageCheck, PackageSearch, Scale, ShoppingCart, Undo2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { ActiveSiteNote, usePartsCtx } from "@/components/parts/PartsUi";
import { fetchPendingSupplierDocs, fetchSupplierMails } from "@/lib/supplier-docs";

export const Route = createFileRoute("/pieces-achats/")({
  head: () => ({
    meta: [
      { title: "Pièces & achats — DDA Connect" },
      { name: "description", content: "Commander, réceptionner et traiter les documents fournisseurs, sur le site actif." },
      { property: "og:title", content: "Pièces & achats — DDA Connect" },
      { property: "og:description", content: "Pilotage des pièces et des achats fournisseurs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PiecesHub,
});

type To = "/pieces-achats/commandes" | "/pieces-achats/reception" | "/pieces-achats/documents" | "/pieces-achats/historique" | "/pieces-achats/stock" | "/pieces-achats/retours" | "/factures-fournisseur" | "/pieces-achats/regulariser" | "/pieces-achats/controle-winmotor";

const MAIN: { to: To; label: string; hint: string; icon: LucideIcon }[] = [
  { to: "/pieces-achats/commandes", label: "Commander des pièces", hint: "Déposez le bon de commande", icon: ShoppingCart },
  { to: "/pieces-achats/reception", label: "Réceptionner des pièces", hint: "Scannez le BL ou choisissez la commande", icon: PackageCheck },
  { to: "/pieces-achats/documents", label: "Documents à traiter", hint: "BL et factures reçus (mail, dépôt)", icon: Inbox },
];

const SECONDARY: { to: To; label: string; icon: LucideIcon }[] = [
  { to: "/pieces-achats/historique", label: "Historique commandes", icon: History },
  { to: "/pieces-achats/stock", label: "Stock / inventaire", icon: PackageSearch },
  { to: "/pieces-achats/retours", label: "Retours / consignes / avoirs", icon: Undo2 },
  { to: "/factures-fournisseur", label: "Factures fournisseur", icon: FileSpreadsheet },
  { to: "/pieces-achats/regulariser", label: "À régulariser", icon: Scale },
  { to: "/pieces-achats/controle-winmotor", label: "Contrôle WinMotor", icon: FileCheck2 },
];

function PiecesHub() {
  const { readSite } = usePartsCtx();
  const docs = useQuery({ queryKey: ["pending-docs", readSite], queryFn: () => fetchPendingSupplierDocs(readSite) });
  const mails = useQuery({ queryKey: ["supplier-mails", readSite], queryFn: () => fetchSupplierMails(readSite) });
  const pending = (docs.data?.length ?? 0) + (mails.data?.length ?? 0);
  return (
    <AppShell title="Pièces & achats" back={{ to: "/" }}>
      <div className="space-y-4">
        <ActiveSiteNote />
        <div className="space-y-3">
          {MAIN.map((e) => {
            const Icon = e.icon;
            return (
              <Link key={e.to} to={e.to} className="flex items-center gap-4 rounded-2xl bg-brand px-4 py-5 text-brand-foreground active:scale-[0.99]">
                <Icon className="h-8 w-8 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-base font-extrabold uppercase tracking-wide">{e.label}</div>
                  <div className="text-xs opacity-80">{e.hint}</div>
                </div>
                {e.to === "/pieces-achats/documents" && pending ? (
                  <span className="rounded-full bg-background px-2 py-0.5 text-xs font-extrabold text-foreground">{pending}</span>
                ) : null}
                <ChevronRight className="h-6 w-6 shrink-0" />
              </Link>
            );
          })}
        </div>
        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase text-muted-foreground">Autres fonctions</h2>
          <div className="grid grid-cols-2 gap-2">
            {SECONDARY.map((e) => {
              const Icon = e.icon;
              return (
                <Link key={e.to} to={e.to} className="flex items-center gap-2 rounded-xl border-2 border-border bg-card px-3 py-3 text-xs font-bold uppercase active:scale-[0.99]">
                  <Icon className="h-4 w-4 shrink-0 text-brand" /> <span className="min-w-0">{e.label}</span>
                </Link>
              );
            })}
            <Link to="/pieces-achats/$section" params={{ section: "references" }} className="flex items-center gap-2 rounded-xl border-2 border-border bg-card px-3 py-3 text-xs font-bold uppercase">
              <ClipboardList className="h-4 w-4 shrink-0 text-brand" /> Références à compléter
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
