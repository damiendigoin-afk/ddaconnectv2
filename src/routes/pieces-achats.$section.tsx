import { createFileRoute, notFound } from "@tanstack/react-router";
import { Construction } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { PIECES_SECTIONS_PENDING, isPendingSection } from "@/lib/v3-nav";

export const Route = createFileRoute("/pieces-achats/$section")({
  beforeLoad: ({ params }) => {
    if (!isPendingSection(params.section)) throw notFound();
  },
  head: () => ({
    meta: [
      { title: "Pièces & achats — en construction V3 — DDA Connect" },
      { name: "description", content: "Section Pièces & achats en cours de construction pour DDA Connect V3." },
      { property: "og:title", content: "Pièces & achats — en construction" },
      { property: "og:description", content: "Section en préparation pour la V3." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PendingSectionPage,
});

function PendingSectionPage() {
  const { section } = Route.useParams();
  const def = isPendingSection(section) ? PIECES_SECTIONS_PENDING[section] : null;
  return (
    <AppShell title={def?.label ?? "Pièces & achats"} subtitle="Pièces & achats" back={{ to: "/pieces-achats" }}>
      <div className="card-surface space-y-3 p-5 text-center">
        <Construction className="mx-auto h-8 w-8 text-brand" />
        <p className="text-base font-extrabold uppercase">En construction V3</p>
        <p className="text-sm text-muted-foreground">{def?.hint}</p>
        <p className="text-xs text-muted-foreground">
          Cette section arrive avec le lot Pièces & achats. Aucune donnée n'est affichée tant qu'elle n'est pas
          branchée sur les vraies données.
        </p>
      </div>
    </AppShell>
  );
}
