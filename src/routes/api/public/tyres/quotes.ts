import { createFileRoute } from "@tanstack/react-router";

/**
 * Devis pneus site vitrine — Top prix, 6 cases (été / 4 saisons × entrée / milieu / haut).
 * Désactivé (503) tant que l'activation n'est pas faite dans Paramètres.
 * Logique et sécurité : src/lib/tire-web-facade.server.ts.
 */
export const Route = createFileRoute("/api/public/tyres/quotes")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const { handleWebQuoteOptions, realFacadeDeps } = await import("@/lib/tire-web-facade.server");
        return handleWebQuoteOptions(request, await realFacadeDeps());
      },
      POST: async ({ request }) => {
        const { handleWebQuotePost, realFacadeDeps } = await import("@/lib/tire-web-facade.server");
        return handleWebQuotePost(request, await realFacadeDeps());
      },
    },
  },
});
