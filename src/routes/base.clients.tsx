import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/AppShell";
import { UniversalSearch } from "@/components/UniversalSearch";

export const Route = createFileRoute("/base/clients")({
  head: () => ({
    meta: [
      { title: "Clients — DDA Connect" },
      { name: "description", content: "Rechercher un client du référentiel DDA Connect par nom, société, téléphone, email ou numéro client." },
      { property: "og:title", content: "Clients — DDA Connect" },
      { property: "og:description", content: "Référentiel clients du garage." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell title="Clients" subtitle="Nom, société, téléphone, email, n° client" back={{ to: "/base" }}>
      <UniversalSearch placeholder="Nom, société, téléphone, email, n° client…" />
    </AppShell>
  ),
});
