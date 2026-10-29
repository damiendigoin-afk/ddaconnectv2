import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { accountingEmailFor, accountLabel, categoryLabel, isAccountPayment, isPersonalPayment, paymentLabel, type ExpenseNote } from "./expenses";
import { expenseDeliveryKey } from "./expense-revision-rules";
import { buildExpenseNotePdf } from "./expense-pdf";

export const sendExpenseRevision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ expenseId: z.string().uuid(), revision: z.number().int().positive(), pdfBase64: z.string().min(100).max(20000000) }).parse(v))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: raw, error } = await sb.from("expense_notes").select("*").eq("id", data.expenseId).single();
    if (error || !raw) throw new Error("Note inaccessible");
    const note = raw as unknown as ExpenseNote;
    const { data: allowed } = await sb.rpc("can_manage_expense", { _user_id: context.userId, _site_id: note.site_id ?? "", _action: "validate" });
    if (!allowed || note.revision !== data.revision || !["soumis", "valide", "annulee"].includes(note.status)) throw new Error("Validation non autorisée ou version obsolète");
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const [{ data: site }, { data: versions }, { data: previous }] = await Promise.all([
      admin.from("sites").select("code,name").eq("id", note.site_id ?? "").single(),
      admin.from("expense_versions").select("revision,snapshot").eq("expense_id", note.id).lt("revision", note.revision).order("revision", { ascending: false }),
      admin.from("expense_revision_deliveries").select("*").eq("expense_id", note.id).lt("revision", note.revision).eq("state", "sent").order("revision", { ascending: false }),
    ]);
    const to = accountingEmailFor(site?.code, site?.name);
    if (!to && !note.cancelled_at) throw new Error("Adresse comptable non configurée");
    const recipients = new Map<string, number>();
    for (const d of previous ?? []) if (!recipients.has(d.recipient)) recipients.set(d.recipient, d.revision);
    // Legacy deliveries are evidence too; no historical row is rewritten.
    for (const v of versions ?? []) {
      const s = v.snapshot as unknown as ExpenseNote;
      if (s.sent_at && s.accounting_email && !recipients.has(s.accounting_email)) recipients.set(s.accounting_email, v.revision);
    }
    if (note.revision === 1 && note.sent_at && note.accounting_email) recipients.set(note.accounting_email, 1);
    const jobs = [...recipients].map(([recipient, target_revision]) => ({ recipient, target_revision, kind: note.cancelled_at || recipient !== to ? "cancel" : "replace" }));
    if (!note.cancelled_at && !recipients.has(to)) jobs.push({ recipient: to, target_revision: 0, kind: "initial" });
    const path = `notes-frais/${note.id}/v${note.revision}/${crypto.randomUUID()}.pdf`;
    const { data: receipt } = note.receipt_path ? await admin.storage.from("dda-media").createSignedUrl(note.receipt_path, 300) : { data: null };
    if (note.receipt_path && !receipt?.signedUrl) throw new Error("Justificatif indisponible : aucun envoi effectué");
    const pdf = await buildExpenseNotePdf({ note: { ...note, validated_at: note.cancelled_at ? null : note.validated_at ?? new Date().toISOString(), validated_by_name: note.validated_by_name ?? String(context.claims["email"] ?? "Validateur") }, siteLabel: site?.name ?? "—", receiptUrl: receipt?.signedUrl ?? null });
    const { error: up } = await admin.storage.from("dda-media").upload(path, pdf as unknown as Blob, { contentType: "application/pdf", upsert: false });
    if (up) throw new Error("Archivage du PDF impossible, aucun envoi effectué");
    // Authenticated client carries auth.uid() into the locked transaction.
    const { error: prep } = await sb.rpc("prepare_expense_revision", { _id: note.id, _revision: note.revision, _pdf: path, _jobs: jobs });
    if (prep) throw prep;
    const { data: deliveries, error: readError } = await admin.from("expense_revision_deliveries").select("*").eq("expense_id", note.id).eq("revision", note.revision);
    if (readError) throw readError;
    const { sendExpenseToAccounting } = await import("./expense-mail.server");
    for (const d of deliveries ?? []) {
      const { data: claimed, error: claimError } = await sb.rpc("claim_expense_revision_delivery", { _delivery: d.id });
      if (claimError) throw claimError;
      if (!claimed) continue;
      const { data: stored } = await admin.storage.from("dda-media").download(d.pdf_path);
      if (!stored) {
        await admin.from("expense_revision_deliveries").update({ state: "failed", error: "PDF archivé indisponible avant envoi" }).eq("id", d.id);
        continue;
      }
      const notice = d.kind === "cancel" ? `ANNULE note ${note.id} v${d.target_revision} — correction v${note.revision}` : d.kind === "replace" ? `REMPLACE note ${note.id} v${d.target_revision} par v${note.revision}` : `Note ${note.id} v${note.revision}${note.revision > 1 ? " — nouvelle affectation, ne pas doubler l'ancienne écriture" : ""}`;
      try {
        const result = await sendExpenseToAccounting({ to: d.recipient, personal: d.kind !== "cancel" && isPersonalPayment(note.payment_method), onAccount: isAccountPayment(note.payment_method), accountLabel: accountLabel(note.account_ref, note.account_other), amount: Number(note.amount_ttc).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }), merchant: note.merchant ?? "—", siteLabel: site?.name ?? "—", spentOn: note.spent_on, purpose: `${note.purpose || categoryLabel(note.category)}. ${note.correction_reason ?? ""}. ${note.accounting_instruction ?? ""}${d.kind === "cancel" ? ". ANNULATION : ne pas comptabiliser ni rembourser ce document." : ""}`, paymentLabel: paymentLabel(note.payment_method), authorName: note.user_name ?? "—", validatorName: String(context.claims["email"] ?? "Validateur"), pdfBase64: Buffer.from(await stored.arrayBuffer()).toString("base64"), filename: `note-${note.id}-v${note.revision}.pdf`, idempotencyKey: expenseDeliveryKey(note.id, note.revision, d.recipient, d.kind), revisionNotice: notice });
        const { error: evidenceError } = await admin.from("expense_revision_deliveries").update({ state: result.ok ? "sent" : result.status === 0 || result.status >= 500 ? "unknown" : "failed", sent_at: result.ok ? new Date().toISOString() : null, provider_id: result.providerId ?? null, error: result.ok ? null : "Envoi non confirmé ; vérifier avant nouvel essai" }).eq("id", d.id);
        if (evidenceError) throw evidenceError;
      } catch {
        await admin.from("expense_revision_deliveries").update({ state: "unknown", error: "Résultat incertain : contrôle manuel requis, pas de réessai automatique" }).eq("id", d.id);
      }
    }
    const { data: final } = await admin.from("expense_revision_deliveries").select("state").eq("expense_id", note.id).eq("revision", note.revision);
    const success = (final ?? []).every(d => d.state === "sent");
    await admin.from("expense_notes").update({ status: note.cancelled_at ? "annulee" : success ? "transmise" : "valide", send_status: success ? "sent" : "failed", sent_at: success && jobs.length ? new Date().toISOString() : null, accounting_email: to || null }).eq("id", note.id).eq("revision", note.revision);
    return { ok: success, error: success ? "" : "Certains envois restent à contrôler dans l'historique." };
  });