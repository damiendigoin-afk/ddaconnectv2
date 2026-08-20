import { createFileRoute } from "@tanstack/react-router";

/**
 * Relève automatique des boîtes Gmail connectées (appelée par pg_cron toutes les 30 min).
 *
 * Sécurité : header `apikey` = clé publishable/anon du projet (aucun secret côté client).
 * Garde-fous : job désactivable depuis /automatisations, verrou anti-concurrence (lease
 * de 20 min sur automation_jobs.last_status), budget borné par exécution, journalisation
 * systématique dans automation_runs.
 */

const JOB_KEY = "emails_sync";
const LEASE_MINUTES = 20;

export const Route = createFileRoute("/api/public/hooks/gmail-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = request.headers.get("apikey");
        const expected =
          process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"] ?? null;
        if (!expected || !apiKey || apiKey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: job } = await supabaseAdmin
          .from("automation_jobs")
          .select("id, enabled, last_status, last_run_at")
          .eq("job_key", JOB_KEY)
          .maybeSingle();

        if (!job) return Response.json({ ok: false, error: "Job introuvable" }, { status: 404 });
        if (!job.enabled) return Response.json({ ok: true, skipped: "job désactivé" });

        // Verrou simple : une exécution en cours et récente bloque la suivante.
        const leaseFresh =
          job.last_status === "en_cours" &&
          job.last_run_at &&
          Date.now() - new Date(job.last_run_at).getTime() < LEASE_MINUTES * 60_000;
        if (leaseFresh) return Response.json({ ok: true, skipped: "synchronisation déjà en cours" });

        const startedAt = new Date().toISOString();
        await supabaseAdmin
          .from("automation_jobs")
          .update({ last_run_at: startedAt, last_status: "en_cours", last_message: "Relève en cours…" })
          .eq("id", job.id);

        let status = "succes";
        let message = "";
        let payload: unknown = null;

        try {
          const { syncAllGmailAccountsServer } = await import("@/lib/gmail-sync.server");
          const res = await syncAllGmailAccountsServer({ maxIncremental: 250, maxBackfill: 150 });
          payload = res;
          if (res.errors > 0) status = res.ingested > 0 ? "partiel" : "echec";
          const parts = res.details.map((d) =>
            d.error
              ? `${d.address} : échec (${d.error})`
              : `${d.address} : ${d.ingested} importé(s), ${d.duplicates} doublon(s)`,
          );
          message =
            `${res.accounts} boîte(s) · ${res.fetched} message(s) lus, ${res.ingested} importé(s), ` +
            `${res.duplicates} doublon(s), ${res.errors} erreur(s)` +
            (res.backfillRemaining ? " · historique en cours de rattrapage" : "") +
            (parts.length ? ` — ${parts.join(" ; ")}` : "");
        } catch (e) {
          status = "echec";
          message = e instanceof Error ? e.message : String(e);
        }

        await supabaseAdmin.from("automation_runs").insert({
          job_id: job.id,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          status,
          message,
        });
        await supabaseAdmin
          .from("automation_jobs")
          .update({ last_run_at: new Date().toISOString(), last_status: status, last_message: message })
          .eq("id", job.id);

        return Response.json({ ok: status !== "echec", status, message, result: payload });
      },
    },
  },
});
