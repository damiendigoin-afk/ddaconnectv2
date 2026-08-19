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
      message = "Relève déclenchée : les nouveaux messages seront classés à la prochaine collecte.";
    } else if (job.job_key === "crm_escalation") {
      const { escalateStale } = await import("@/lib/crm");
      const n = await escalateStale();
      message = `${n} demande(s) client escaladée(s).`;
    } else if (job.job_key === "dunning_reminders") {
      const n = await runDunningReminders();
      message = `${n.sent} relance(s) envoyée(s) sur ${n.due} créance(s) éligible(s).`;
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