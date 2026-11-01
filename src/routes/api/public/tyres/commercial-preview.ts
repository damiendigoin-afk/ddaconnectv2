import { createFileRoute } from "@tanstack/react-router";

/** DDA Pneus V10 — aperçu PDF du devis commercial (non envoyé). Inactif (503) tant que TYRES_V10_ENABLED n'est pas "true". Contrat : docs/DDA-PNEUS-V10-API.md. */
export const Route = createFileRoute("/api/public/tyres/commercial-preview")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const s = await import("@/lib/tire-v10.server");
        return s.handleV10Options(request, await s.realV10Deps(request), "POST, OPTIONS");
      },
      POST: async ({ request }) => {
        const s = await import("@/lib/tire-v10.server");
        return s.handleCommercialPreview(request, await s.realV10Deps(request));
      },
    },
  },
});
