import { createFileRoute } from "@tanstack/react-router";

/**
 * Mesure d'audience DDA Pneus (liste blanche, consentement). Active seulement si
 * tyre_rpt_settings.events_enabled — indépendant de TYRES_V10_ENABLED. Sinon 503.
 * Logique : src/lib/tyre-reporting.server.ts. Contrat : docs/DDA-PNEUS-REPORTING.md.
 */
async function deps() {
  const c = await import("@/lib/tire-web-contact.server");
  const r = await import("@/lib/tyre-reporting.server");
  const base = await c.realContactDeps();
  return { r, d: await r.realRptEventsDeps(base.loadConfig) };
}

export const Route = createFileRoute("/api/public/tyres/events")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const { r, d } = await deps();
        return r.handleRptEventsOptions(request, d);
      },
      POST: async ({ request }) => {
        const { r, d } = await deps();
        return r.handleRptEvents(request, d);
      },
    },
  },
});
