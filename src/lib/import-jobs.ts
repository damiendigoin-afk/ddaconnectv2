/**
 * Reprise serveur des imports (tous modules) : l'état d'un import est persisté
 * en base, pas seulement dans le navigateur. Un import interrompu (fermeture,
 * coupure, changement de poste) reprend sans retraiter les pages terminées.
 */
import { supabase } from "@/integrations/supabase/client";

export type ImportJobPayload = {
  version: string | null;
  donePages: number[];
  lines: unknown[];
  uncertain: string[];
};

export type ImportJob = {
  id: string;
  job_key: string;
  kind: string;
  file_name: string;
  file_size: number | null;
  file_fingerprint: string | null;
  total_pages: number | null;
  status: string;
  updated_at: string;
  state: ImportJobPayload;
};

export function jobKey(module: string, fingerprint: string, kind: string) {
  return `${module}:${kind}:${fingerprint}`;
}

export async function saveImportJob(input: {
  key: string;
  kind: string;
  fileName: string;
  fileSize: number;
  fingerprint: string;
  totalPages: number;
  status?: string;
  state: ImportJobPayload;
  userId: string | null;
}) {
  const { error } = await supabase.from("import_jobs").upsert(
    {
      job_key: input.key,
      kind: input.kind,
      file_name: input.fileName,
      file_size: input.fileSize,
      file_fingerprint: input.fingerprint,
      total_pages: input.totalPages,
      status: input.status ?? "running",
      state: input.state as never,
      user_id: input.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "job_key" },
  );
  if (error) console.error("import job save failed", error.message);
}

export async function loadImportJob(key: string): Promise<ImportJob | null> {
  const { data } = await supabase.from("import_jobs").select("*").eq("job_key", key).maybeSingle();
  return (data as ImportJob | null) ?? null;
}

/** Dernier import inachevé de l'utilisateur pour un module donné. */
export async function latestRunningJob(module: string): Promise<ImportJob | null> {
  const { data } = await supabase
    .from("import_jobs")
    .select("*")
    .like("job_key", `${module}:%`)
    .eq("status", "running")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ImportJob | null) ?? null;
}

export async function finishImportJob(key: string) {
  await supabase.from("import_jobs").update({ status: "done" }).eq("job_key", key);
}

export async function deleteImportJob(key: string) {
  await supabase.from("import_jobs").delete().eq("job_key", key);
}
