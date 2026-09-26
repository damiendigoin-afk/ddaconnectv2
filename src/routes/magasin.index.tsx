/** V3 : l'ancien accueil Magasin est remplacé par le hub Pièces & achats (favoris conservés). */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/magasin/")({
  beforeLoad: () => {
    throw redirect({ to: "/pieces-achats", replace: true });
  },
});
