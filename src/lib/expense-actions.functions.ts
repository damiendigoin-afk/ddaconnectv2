import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { expenseTransition, type ExpenseAction } from "./expenses";

const actionInput = z.object({
  expenseId: z.string().uuid(),
  action: z.enum(["resubmit", "reject", "settle", "account", "mark_seen", "archive", "restore", "reconcile"]),
  detail: z.string().max(500).optional(),
});


export const transitionExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => actionInput.parse(value))
  .handler(async ({ data, context }) => {
    const [{ data: roles }, { data: functions }, { data: modules }, { data: profile }] = await Promise.all([
      context.supabase.from("user_roles").select("role").eq("user_id", context.userId),
      context.supabase.from("user_functions").select("function_key").eq("user_id", context.userId),
      context.supabase.from("user_module_access").select("module_key, allowed").eq("user_id", context.userId),
      context.supabase.from("profiles").select("first_name, last_name, email").eq("id", context.userId).maybeSingle(),
    ]);
    const roleSet = new Set(((roles ?? []) as { role: string }[]).map((row) => row.role));
    const functionSet = new Set(((functions ?? []) as { function_key: string }[]).map((row) => row.function_key));
    const moduleSet = new Set(
      ((modules ?? []) as { module_key: string; allowed: boolean }[]).filter((row) => row.allowed).map((row) => row.module_key),
    );
    const manager = roleSet.has("manager");
    const canValidate = manager || functionSet.has("valider_notes_frais") || moduleSet.has("notes_frais_valider");
    const canAccount = manager || functionSet.has("comptabilite") || moduleSet.has("notes_frais_compta");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: note } = await supabaseAdmin
      .from("expense_notes")
      .select("id, user_id, site_id, status, payment_method, archived_at")
      .eq("id", data.expenseId)
      .maybeSingle();

    if (!note) throw new Error("Note de frais introuvable");

    const owner = note.user_id === context.userId;
    if (!manager && note.site_id) {
      const { data: siteAllowed } = await context.supabase.rpc("user_can_access_site", {
        _user_id: context.userId,
        _site_id: note.site_id,
      });
      if (!siteAllowed && !owner) throw new Error("Établissement non autorisé");
    }

    const action = data.action as ExpenseAction;
    if (action === "resubmit" && (!owner || !["brouillon", "refuse"].includes(note.status))) throw new Error("Action non autorisée");
    if (action === "reject" && (!canValidate || note.status !== "soumis")) throw new Error("Action non autorisée");
    if (action === "settle" && (!canAccount || note.status !== "transmise" || note.payment_method !== "perso")) {
      throw new Error("Action non autorisée");
    }
    if (action === "account" && (!canAccount || note.status !== "transmise" || note.payment_method === "perso")) {
      throw new Error("Action non autorisée");
    }
    if (action === "mark_seen" && (!owner || !["reglee", "comptabilisee"].includes(note.status))) {
      throw new Error("Action non autorisée");
    }
    if (action === "reconcile" && (!canAccount || note.status !== "transmise" || note.payment_method !== "en_compte")) {
      throw new Error("Action non autorisée");
    }
    if ((action === "archive" || action === "restore") && !(owner || canValidate || canAccount)) {
      throw new Error("Action non autorisée");
    }
    if (action === "archive" && note.archived_at) throw new Error("Note déjà archivée");
    if (action === "restore" && !note.archived_at) throw new Error("Note non archivée");

    const p = profile as { first_name?: string | null; last_name?: string | null; email?: string | null } | null;
    const actorName = [p?.first_name, p?.last_name].filter(Boolean).join(" ") || p?.email || "Utilisateur";
    const patch = expenseTransition(action, new Date().toISOString(), actorName, data.detail);
    if (action === "archive") (patch as Record<string, unknown>)["archived_by"] = context.userId;
    const { error } = await supabaseAdmin.from("expense_notes").update(patch as never).eq("id", data.expenseId);

    if (error) throw error;
    return { ok: true as const };
  });