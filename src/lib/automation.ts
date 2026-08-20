import { supabase } from "@/integrations/supabase/client";

export type AutomationJob = {
  id: string;
  job_key: string;
  label: string;
  description: string | null;
  schedule: string | null;
  enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_message: string | null;
};

export type AutomationRun = {
  id: string;
  job_id: string | null;
  started_at: string;
  finished_at: string | null;
  status: string;
  message: string | null;
};

export async function listJobs(): Promise<AutomationJob[]> {
  const { data, error } = await supabase
    .from("automation_jobs")
    .select("id, job_key, label, description, schedule, enabled, last_run_at, last_status, last_message")
    .order("label");
  if (error) throw error;
  return (data ?? []) as AutomationJob[];
}

export async function listRuns(): Promise<AutomationRun[]> {
  const { data, error } = await supabase
    .from("automation_runs")
    .select("id, job_id, started_at, finished_at, status, message")
    .order("started_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as AutomationRun[];
}

export async function toggleJob(id: string, enabled: boolean) {
  const { error } = await supabase.from("automation_jobs").update({ enabled }).eq("id", id);
  if (error) throw error;
}

/** Exécute une automatisation à la demande et journalise le résultat. */
export async function runJob(job: AutomationJob): Promise<string> {
  const startedAt = new Date().toISOString();
  let status = "succes";
  let message = "";
  try {
    if (job.job_key === "purge_drafts") {
      const { data, error } = await supabase.rpc("purge_stale_drafts", { _days: 7 });
      if (error) throw error;
      const row = (data as { inspections_deleted: number; returns_deleted: number }[] | null)?.[0];
      message = `${row?.inspections_deleted ?? 0} tour(s) et ${row?.returns_deleted ?? 0} retour(s) purgés.`;
    } else if (job.job_key === "maintenance_scan") {
      const { rebuildPredictions } = await import("@/lib/maintenance");
      const n = await rebuildPredictions();
      message = `${n} échéance(s) recalculée(s).`;
    } else if (job.job_key === "emails_sync") {
      const { syncAllGmailAccounts } = await import("@/lib/gmail.functions");
      const res = await syncAllGmailAccounts();
      const parts = res.details.map((d) =>
        d.error ? `${d.address} : échec (${d.error})` : `${d.address} : ${d.ingested} importé(s), ${d.duplicates} doublon(s)`,
      );
      if (res.errors > 0) status = "partiel";
      message =
        `${res.accounts} boîte(s) · ${res.fetched} message(s) lus, ${res.ingested} importé(s), ` +
        `${res.duplicates} doublon(s), ${res.errors} erreur(s)` +
        (res.backfillRemaining ? " · historique en cours de rattrapage" : "") +
        (parts.length ? ` — ${parts.join(" ; ")}` : "");

    } else if (job.job_key === "crm_escalation") {
      const { escalateStale } = await import("@/lib/crm");
      const n = await escalateStale();
      message = `${n} demande(s) client escaladée(s).`;
    } else if (job.job_key === "dunning_reminders") {
      const n = await runDunningReminders();
      message = `${n.sent} relance(s) envoyée(s) sur ${n.due} créance(s) éligible(s).`;
    } else if (job.job_key === "returns_followup") {
      const { runReturnFollowupsFn } = await import("@/lib/returns.functions");
      const res = await runReturnFollowupsFn();
      if (res.errors.length) status = "partiel";
      message =
        `${res.scanned} retour(s) analysé(s) · ${res.reminders} relance(s), ${res.escalations} escalade(s)` +
        (res.errors.length ? ` — ${res.errors.join(" ; ")}` : "");

    } else {
      status = "ignore";
      message = "Automatisation inconnue.";
    }
  } catch (e) {
    status = "echec";
    message = e instanceof Error ? e.message : String(e);
  }
  await supabase.from("automation_runs").insert({
    job_id: job.id,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    status,
    message,
  } as never);
  await supabase
    .from("automation_jobs")
    .update({ last_run_at: new Date().toISOString(), last_status: status, last_message: message })
    .eq("id", job.id);
  if (status === "echec") throw new Error(message);
  return message;
}
/** Relances automatiques des créances de plus de 30 jours (cooldown 15 j). */
export async function runDunningReminders(): Promise<{ due: number; sent: number }> {
  const { listReceivables, fetchDunningLog, needsDunning } = await import("@/lib/pilotage");
  const { sendReceivableReminder } = await import("@/lib/dunning.functions");

  const rows = await listReceivables(null);
  const log = await fetchDunningLog(rows.map((r) => r.case_id));
  const due = rows.filter((r) => needsDunning(r, log.get(r.case_id)));
  if (!due.length) return { due: 0, sent: 0 };

  const ids = due.slice(0, 25).map((r) => r.case_id);
  const { data, error } = await supabase
    .from("bodyshop_cases")
    .select("id, customer_email")
    .in("id", ids);
  if (error) throw error;
  const emails = new Map(
    ((data ?? []) as { id: string; customer_email: string | null }[])
      .filter((r) => r.customer_email && /.+@.+\..+/.test(r.customer_email))
      .map((r) => [r.id, r.customer_email as string]),
  );

  let sent = 0;
  for (const id of ids) {
    const to = emails.get(id);
    if (!to) continue;
    const res = await sendReceivableReminder({ data: { caseId: id, to, authorName: "Automatisation" } });
    if (res.ok) sent += 1;
  }
  return { due: due.length, sent };
}
