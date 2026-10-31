import { createFileRoute } from "@tanstack/react-router";

/**
 * Suggestion du garage le plus proche (approximative, facultative) pour le site DDA Pneus.
 * Désactivée (503) tant que le devis web n'est pas activé. Logique : src/lib/tire-web-site-suggest.server.ts.
 */
export const Route = createFileRoute("/api/public/tyres/site-suggestion")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const { handleAppointmentOptions, realAppointmentDeps } = await import("@/lib/tire-web-appointment.server");
        return handleAppointmentOptions(request, await realAppointmentDeps());
      },
      POST: async ({ request }) => {
        const { handleSuggestPost, realSuggestDeps } = await import("@/lib/tire-web-site-suggest.server");
        return handleSuggestPost(request, await realSuggestDeps());
      },
    },
  },
});
