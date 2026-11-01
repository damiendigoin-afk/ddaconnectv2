import { createFileRoute } from "@tanstack/react-router";

/**
 * Demande de contact pneus simplifiée : un seul e-mail au garage choisi.
 * Gardée par le réglage devis web existant (enabled + allowed_origins).
 * Logique et sécurité : src/lib/tire-web-contact.server.ts.
 */
export const Route = createFileRoute("/api/public/tyres/contact-request")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const { handleContactOptions, realContactDeps } = await import("@/lib/tire-web-contact.server");
        return handleContactOptions(request, await realContactDeps());
      },
      POST: async ({ request }) => {
        const { handleContactPost, realContactDeps } = await import("@/lib/tire-web-contact.server");
        return handleContactPost(request, await realContactDeps());
      },
    },
  },
});
