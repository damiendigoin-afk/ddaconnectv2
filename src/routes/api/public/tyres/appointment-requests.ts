import { createFileRoute } from "@tanstack/react-router";

/**
 * Demande de rendez-vous pneus (statut « à confirmer ») depuis le site vitrine.
 * Désactivée (503) tant que le devis web n'est pas activé dans Paramètres.
 * Logique et sécurité : src/lib/tire-web-appointment.server.ts.
 */
export const Route = createFileRoute("/api/public/tyres/appointment-requests")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const { handleAppointmentOptions, realAppointmentDeps } = await import("@/lib/tire-web-appointment.server");
        return handleAppointmentOptions(request, await realAppointmentDeps());
      },
      POST: async ({ request }) => {
        const { handleAppointmentPost, realAppointmentDeps } = await import("@/lib/tire-web-appointment.server");
        return handleAppointmentPost(request, await realAppointmentDeps());
      },
    },
  },
});
