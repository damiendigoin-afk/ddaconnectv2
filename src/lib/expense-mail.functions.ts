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

    const [{ data: roles }, { data: functions }] = await Promise.all([
      sb.from("user_roles").select("role").eq("user_id", context.userId),
      sb.from("user_functions").select("function_key").eq("user_id", context.userId),
    ]);
    const isManager = ((roles ?? []) as { role: string }[]).some((r) => r.role === "manager");
    const canValidate =
      isManager ||
      ((functions ?? []) as { function_key: string }[]).some((f) => f.function_key === "valider_notes_frais");
    if (!canValidate) {
      return { ok: false as const, error: "Vous n'êtes pas autorisé à valider les notes de frais." };
    }

    const { data: note, error } = await sb
      .from("expense_notes")
      .select("id, user_name, site_id, spent_on, category, purpose, merchant, amount_ttc, payment_method, status")
      .eq("id", data.expenseId)
      .maybeSingle();
    if (error || !note) return { ok: false as const, error: "Note de frais introuvable." };

    const { data: site } = note.site_id
      ? await sb.from("sites").select("code, name").eq("id", note.site_id).maybeSingle()
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
    await sb
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
      } as never)
      .eq("id", data.expenseId);

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
        idempotencyKey: `expense:${data.expenseId}:${data.attempt ?? "auto"}`,
      });
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    await sb
      .from("expense_notes")
      .update(
        result.ok
          ? { status: "transmise", sent_at: new Date().toISOString(), send_status: "sent", send_error: null }
          : { status: "valide", send_status: "failed", send_error: result.error.slice(0, 500) },
      )
      .eq("id", data.expenseId);

    return result.ok
      ? { ok: true as const, error: "", to }
      : { ok: false as const, error: `Validée, mais envoi comptable échoué : ${result.error}` };
  });
