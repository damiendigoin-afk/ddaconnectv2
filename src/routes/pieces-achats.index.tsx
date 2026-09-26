import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, ClipboardList, FileSpreadsheet, PackageCheck, PackageSearch, Scale, ShoppingCart, Undo2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/pieces-achats/")({
  head: () => ({
    meta: [
      { title: "Pièces & achats — DDA Connect" },
      {
        name: "description",
        content: "Commandes, réception, stock, factures fournisseur, retours et avoirs de l'atelier.",
      },
      { property: "og:title", content: "Pièces & achats — DDA Connect" },
      { property: "og:description", content: "Pilotage des pièces et des achats fournisseurs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PiecesHub,
});

type Entry = { label: string; hint: string; icon: LucideIcon; ready: boolean } & (
  | { to: "/factures-fournisseur" | "/pieces-achats/retours" }
  | { to: "/pieces-achats/$section"; section: string }
);

const ENTRIES: Entry[] = [
  { to: "/pieces-achats/$section", section: "commandes", label: "Commandes", hint: "Commandes fournisseurs par OR", icon: ShoppingCart, ready: false },
  { to: "/pieces-achats/$section", section: "reception", label: "Réception pièces", hint: "Contrôle des livraisons", icon: PackageCheck, ready: false },
  { to: "/pieces-achats/$section", section: "stock", label: "Stock / inventaire", hint: "Quantités et inventaires", icon: PackageSearch, ready: false },
  { to: "/factures-fournisseur", label: "Factures fournisseur", hint: "BL et factures : dépôt, lecture automatique, rattachement OR", icon: FileSpreadsheet, ready: true },
  { to: "/pieces-achats/retours", label: "Retours / consignes / avoirs", hint: "Retours fournisseurs, consignes et avoirs attendus", icon: Undo2, ready: true },
  { to: "/pieces-achats/$section", section: "references", label: "Références à compléter", hint: "Pièces sans référence exploitable", icon: ClipboardList, ready: false },
  { to: "/pieces-achats/$section", section: "regulariser", label: "À régulariser", hint: "Écarts pointé / commandé / facturé", icon: Scale, ready: false },
];

function PiecesHub() {
  return (
    <AppShell title="Pièces & achats" back={{ to: "/" }}>
      <div className="space-y-2">
        {ENTRIES.map((e) => {
          const Icon = e.icon;
          const body = (
            <>
              <Icon className="h-6 w-6 shrink-0 text-brand" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide">
                  {e.label}
                  {!e.ready ? (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                      En construction V3
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">{e.hint}</div>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0" />
            </>
          );
          const cls = "flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]";
          return "section" in e ? (
            <Link key={e.label} to={e.to} params={{ section: e.section }} className={cls}>
              {body}
            </Link>
          ) : (
            <Link key={e.label} to={e.to} className={cls}>
              {body}
            </Link>
          );
        })}
      </div>
    </AppShell>
  );
}
