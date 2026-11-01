import { createFileRoute } from "@tanstack/react-router";

/**
 * Rapport quotidien DDA Pneus, appelé par pg_cron toutes les heures (UTC).
 * Bearer vérifié contre un secret Vault via RPC service_role ; n'agit qu'à 7 h Paris
 * (réessai contrôlé jusqu'à 10 h), une émission par date. Logique : src/lib/tyre-reporting.server.ts.
 */
export const Route = createFileRoute("/api/public/tyres/reporting-daily")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const r = await import("@/lib/tyre-reporting.server");
        return r.handleDailyReportCron(request, await r.realReportDeps());
      },
    },
  },
});
