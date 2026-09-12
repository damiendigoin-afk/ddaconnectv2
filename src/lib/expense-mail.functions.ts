import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ACCOUNTING_EMAILS, isPersonalPayment, paymentLabel, categoryLabel } from "./expenses";

const input = z.object({
  expenseId: z.string().uuid(),
  pdfBase64: z.string().min(100),
  attempt: z.string().max(60).optional(),
});

/**
 * Validation d'une note de frais puis transmission automatique à la
 * comptabilité de l'établissement. La note n'est jamais marquée transmise si
 * l'e-mail n'est pas réellement parti.
 */
export const validateAndSendExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;

    const [{ data: roles }, { data: functions }, { data: modules }] = await Promise.all([
      sb.from("user_roles").select("role").eq("user_id", context.userId),
      sb.from("user_functions").select("function_key").eq("user_id", context.userId),
      sb.from("user_module_access").select("module_key, allowed").eq("user_id", context.userId),
    ]);
    const isManager = ((roles ?? []) as { role: string }[]).some((r) => r.role === "manager");
    const canValidate =
      isManager ||
      ((functions ?? []) as { function_key: string }[]).some((f) => f.function_key === "valider_notes_frais") ||
      ((modules ?? []) as { module_key: string; allowed: boolean }[]).some(
        (m) => m.module_key === "notes_frais_valider" && m.allowed,
      );
    if (!canValidate) {
      return { ok: false as const, error: "Vous n'êtes pas autorisé à valider les notes de frais." };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: note, error } = await supabaseAdmin
      .from("expense_notes")
      .select("id, user_id, user_name, site_id, spent_on, category, purpose, merchant, amount_ttc, payment_method, status")
      .eq("id", data.expenseId)
      .maybeSingle();
    if (error || !note) return { ok: false as const, error: "Note de frais introuvable." };
    if (!isManager && note.site_id) {
      const { data: siteAllowed } = await sb.rpc("user_can_access_site", {
        _user_id: context.userId,
        _site_id: note.site_id,
      });
      if (!siteAllowed) return { ok: false as const, error: "Établissement non autorisé." };
    }
    if (note.status !== "soumis" && !(note.status === "valide" && data.attempt)) {
      return { ok: false as const, error: "Cette note ne peut pas être validée dans son état actuel." };
    }

    const { data: site } = note.site_id
      ? await supabaseAdmin.from("sites").select("code, name").eq("id", note.site_id).maybeSingle()
      : { data: null };
    const siteCode = (site as { code: string | null } | null)?.code ?? "";
    const siteLabel = (site as { name: string } | null)?.name ?? "Établissement non renseigné";
    const to = ACCOUNTING_EMAILS[siteCode] ?? "";
    if (!to) {
      return {
        ok: false as const,
        error: "Aucune adresse comptable connue pour cet établissement : renseignez le site de la note.",
      };
    }

    const validatorName = context.claims?.["email"] ? String(context.claims["email"]) : "";
    const { data: me } = await sb
      .from("profiles")
      .select("first_name, last_name, email")
      .eq("id", context.userId)
      .maybeSingle();
    const validator =
      [(me as { first_name?: string } | null)?.first_name, (me as { last_name?: string } | null)?.last_name]
        .filter(Boolean)
        .join(" ") || validatorName || "Manager";

    const nowIso = new Date().toISOString();
    const personal = isPersonalPayment(note.payment_method as string);
    const amount = Number(note.amount_ttc ?? 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

    // Validation enregistrée avant l'envoi : le document A4 est figé « VALIDÉ ».
    const pdfPath = `notes-frais/${note.id}/note-validee.pdf`;
    const pdfBytes = Buffer.from(data.pdfBase64, "base64");
    const { error: uploadError } = await supabaseAdmin.storage
      .from("dda-media")
      .upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (uploadError) return { ok: false as const, error: `Document validé non archivé : ${uploadError.message}` };

    const { error: validationError } = await supabaseAdmin
      .from("expense_notes")
      .update({
        status: "valide",
        validated_by: context.userId,
        validated_by_name: validator,
        validated_at: nowIso,
        reviewed_at: nowIso,
        reviewed_by: context.userId,
        reject_reason: null,
        accounting_email: to,
        validated_pdf_path: pdfPath,
      } as never)
      .eq("id", data.expenseId);
    if (validationError) return { ok: false as const, error: `Validation non enregistrée : ${validationError.message}` };

    const { sendExpenseToAccounting } = await import("./expense-mail.server");
    let result: { ok: boolean; error: string };
    try {
      result = await sendExpenseToAccounting({
        to,
        personal,
        amount,
        merchant: (note.merchant as string) || "—",
        siteLabel,
        spentOn: new Date(note.spent_on as string).toLocaleDateString("fr-FR"),
        purpose: (note.purpose as string) || categoryLabel(note.category as string),
        paymentLabel: paymentLabel(note.payment_method as string),
        authorName: (note.user_name as string) || "Salarié",
        validatorName: validator,
        pdfBase64: data.pdfBase64,
        filename: `note-de-frais-${String(data.expenseId).slice(0, 8)}.pdf`,
        // Stable across retries: a network timeout must never create a second
        // accounting email for the same validated expense.
        idempotencyKey: `expense:${data.expenseId}:accounting`,
      });
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    const { error: finalError } = await supabaseAdmin
      .from("expense_notes")
      .update(
        result.ok
          ? { status: "transmise", sent_at: new Date().toISOString(), send_status: "sent", send_error: null }
          : { status: "valide", send_status: "failed", send_error: result.error.slice(0, 500) },
      )
      .eq("id", data.expenseId);
    if (finalError) return { ok: false as const, error: `Statut d'envoi non enregistré : ${finalError.message}` };

    return result.ok
      ? { ok: true as const, error: "", to }
      : { ok: false as const, error: `Validée, mais envoi comptable échoué : ${result.error}` };
  });
