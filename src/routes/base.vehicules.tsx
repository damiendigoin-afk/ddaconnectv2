import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/AppShell";
import { UniversalSearch } from "@/components/UniversalSearch";

export const Route = createFileRoute("/base/vehicules")({
  head: () => ({
    meta: [
      { title: "Véhicules — DDA Connect" },
      { name: "description", content: "Rechercher un véhicule du référentiel DDA Connect par immatriculation, VIN ou numéro véhicule." },
      { property: "og:title", content: "Véhicules — DDA Connect" },
      { property: "og:description", content: "Parc véhicules du garage." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell title="Véhicules" subtitle="Immatriculation, VIN, n° véhicule" back={{ to: "/base" }}>
      <UniversalSearch placeholder="Immatriculation, VIN, n° véhicule…" />
    </AppShell>
  ),
});
