/** Devis pneus — route parente : la saisie, l'historique et le PDF sont ses enfants. */
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/devis/pneus")({
  component: () => <Outlet />,
});
