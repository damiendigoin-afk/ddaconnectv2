import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type ReportActor = { userId: string; supabase: SupabaseClient<Database> };
export class ReportFailure extends Error {
  constructor(
    public code: "unauthenticated" | "forbidden" | "not_found" | "database" | "send",
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function logReportFailure(stage: string, id: string, error: unknown) {
  // No bearer, recipient, report content or signed URL in technical logs.
  const e = error as { code?: string; status?: number; message?: string };
  console.error("[report-email]", {
    stage,
    reportId: id,
    code: e?.code,
    status: e?.status,
    detail: String(e?.message ?? "Unexpected failure")
      .replace(/https?:\/\/\S+|Bearer\s+\S+/gi, "[redacted]")
      .slice(0, 500),
  });
}

export function databaseFailure(error: { code?: string; message?: string }) {
  if (error.code === "42501")
    return new ReportFailure("forbidden", 403, "Accès interdit à ce compte rendu");
  return new ReportFailure(
    "database",
    500,
    "Chargement du compte rendu impossible. Réessayez plus tard.",
  );
}

/** User RLS remains authoritative; admin is never used to grant access. */
export async function authorizeReport(actor: ReportActor, id: string, kind: "tour" | "expertise") {
  if (!actor?.userId || !actor.supabase)
    throw new ReportFailure("unauthenticated", 401, "Connectez-vous pour envoyer ce compte rendu");
  const db = actor.supabase;
  const { data: active, error: activeError } = await db.rpc("is_active_user", {
    _user_id: actor.userId,
  });
  if (activeError) {
    logReportFailure("active-user", id, activeError);
    throw databaseFailure(activeError);
  }
  if (active !== true) throw new ReportFailure("forbidden", 403, "Votre compte n’est pas actif");
  const { data: manager, error: roleError } = await db.rpc("has_role", {
    _user_id: actor.userId,
    _role: "manager",
  });
  if (roleError) {
    logReportFailure("role", id, roleError);
    throw databaseFailure(roleError);
  }
  if (manager !== true) {
    const { data: grants, error } = await db
      .from("user_module_access")
      .select("module_key, allowed")
      .eq("user_id", actor.userId)
      .eq("module_key", kind)
      .eq("allowed", true);
    if (error) {
      logReportFailure("module", id, error);
      throw databaseFailure(error);
    }
    if (!grants?.length)
      throw new ReportFailure("forbidden", 403, "Vous n’avez pas accès à ce module");
  }
  const table = kind === "tour" ? "vehicle_inspections" : "vehicle_expertises";
  const { data: row, error } = await db
    .from(table)
    .select("id, site_id")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    logReportFailure("user-read", id, error);
    throw databaseFailure(error);
  }
  if (!row) {
    // Identity, active state and menu permission verified first. Existence-only
    // probe distinguishes a hidden row from an unknown ID, never authorizes it.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: exists, error: probeError } = await supabaseAdmin
      .from(table)
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (probeError) {
      logReportFailure("existence", id, probeError);
      throw databaseFailure(probeError);
    }
    if (exists) throw new ReportFailure("forbidden", 403, "Accès interdit à ce compte rendu");
    throw new ReportFailure(
      "not_found",
      404,
      kind === "tour" ? "Tour introuvable" : "Expertise introuvable",
    );
  }
  if (row.site_id) {
    const { data: allowed, error: siteError } = await db.rpc("user_can_access_site", {
      _user_id: actor.userId,
      _site_id: row.site_id,
    });
    if (siteError) {
      logReportFailure("site", id, siteError);
      throw databaseFailure(siteError);
    }
    if (allowed !== true)
      throw new ReportFailure("forbidden", 403, "Accès interdit à cet établissement");
  } else if (manager !== true) {
    throw new ReportFailure("forbidden", 403, "Ce compte rendu n’a pas d’établissement rattaché");
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
