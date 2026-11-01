import { createFileRoute } from "@tanstack/react-router";

/** DDA Pneus V10 — événements de trafic (liste blanche, consentement). Inactif (503) tant que TYRES_V10_ENABLED n'est pas "true". Contrat : docs/DDA-PNEUS-V10-API.md. */
export const Route = createFileRoute("/api/public/tyres/events")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const s = await import("@/lib/tire-v10.server");
        return s.handleV10Options(request, await s.realV10Deps(request), "POST, OPTIONS");
      },
      POST: async ({ request }) => {
        const s = await import("@/lib/tire-v10.server");
        return s.handleEvents(request, await s.realV10Deps(request));
      },
    },
  },
});
