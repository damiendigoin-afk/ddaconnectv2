import {
  categorizeEmail,
  emailFingerprint,
  findPlates,
  matchEmailRule,
  messageKind,
  threadKeyOf,
  type EmailRule,
} from "@/lib/emails-core";
import type { IncomingEmail } from "@/lib/emails";
import { dueAtFrom, expiresAtFrom, triageIncoming } from "@/lib/triage-core";


/**
 * Ingestion serveur (service role) : contourne RLS car appelée depuis
 * une server function / route API sans session utilisateur.
 */
export async function ingestEmailServer(
  e: IncomingEmail,
): Promise<{ emailId: string; duplicate: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const fingerprint = emailFingerprint({
    rfcMessageId: e.rfcMessageId ?? null,
    from: e.from,
    subject: e.subject ?? null,
    sentAt: e.sentAt,
    body: e.bodyText ?? e.bodyHtml ?? null,
  });

  const existing = await supabaseAdmin
    .from("emails")
    .select("id")
    .eq("fingerprint", fingerprint)
    .maybeSingle();
  let emailId: string | null = existing.data?.id ?? null;
  const duplicate = !!emailId;

  if (!emailId) {
    let cat = categorizeEmail({ subject: e.subject, body: e.bodyText ?? e.bodyHtml, from: e.from });
    let categorySource = "auto";
    // Règles de tri déterministes enregistrées par les utilisateurs : priorité absolue.
    const { data: rules } = await supabaseAdmin
      .from("email_rules")
      .select("id, match_type, match_value, category");
    const rule = matchEmailRule((rules ?? []) as EmailRule[], { from: e.from, subject: e.subject });
    if (rule) {
      cat = { category: rule.category as typeof cat.category, confidence: 1 };
      categorySource = "regle";
    }
    const tri = triageIncoming({
      subject: e.subject,
      body: e.bodyText ?? e.bodyHtml,
      from: e.from,
      hasAttachments: !!e.attachments?.length,
    });

    const { data, error } = await supabaseAdmin
      .from("emails")
      .insert({
        fingerprint,
        rfc_message_id: e.rfcMessageId ?? null,
        gmail_thread_id: e.gmailThreadId ?? null,
        thread_key: threadKeyOf({ gmailThreadId: e.gmailThreadId ?? null, subject: e.subject, from: e.from }),
        sent_at: e.sentAt,
        from_address: e.from.toLowerCase(),
        from_name: e.fromName ?? null,
        to_addresses: e.to ?? [],
        cc_addresses: e.cc ?? [],
        subject: e.subject ?? null,
        snippet: (e.bodyText ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null,
        body_text: e.bodyText ?? null,
        body_html: e.bodyHtml ?? null,
        kind: messageKind(e.subject),
        category: cat.category,
        category_confidence: cat.confidence,
        category_source: categorySource,
        importance: tri.importance,
        urgency: tri.urgency,
        action_required: tri.actionRequired,
        human_required: tri.humanRequired,
        services: tri.services,
        due_at: dueAtFrom(e.sentAt, tri.dueInMinutes),
        expires_at: expiresAtFrom(e.sentAt, tri.expiresInDays),
        triage_status: tri.status,
        triage_confidence: tri.confidence,
        triage_reason: tri.reason,
        site_id: e.siteId ?? null,
        has_attachments: !!e.attachments?.length,
      })
      .select("id")
      .single();
    if (error) throw error;
    emailId = data.id as string;

    if (e.attachments?.length) {
      await supabaseAdmin.from("email_attachments").insert(
        e.attachments.map((a) => ({
          email_id: emailId as string,
          filename: a.filename,
          mime_type: a.mimeType ?? null,
          size_bytes: a.sizeBytes ?? null,
        })),
      );
    }
  }

  if (!duplicate) await autoLinkVehicle(supabaseAdmin, emailId, e);

  await supabaseAdmin.from("email_receipts").upsert(
    {
      email_id: emailId as string,
      account_id: e.accountId ?? null,
      mailbox_address: e.mailbox.toLowerCase(),
      person_name: e.personName ?? null,
      gmail_message_id: e.gmailMessageId ?? null,
    },
    { onConflict: "email_id,mailbox_address" },
  );

  return { emailId: emailId as string, duplicate };
}

/**
 * Rattachement véhicule / client par immatriculation exacte (regex + base).
 * Aucun OCR, aucune IA : en cas d'ambiguïté, l'e-mail reste « à confirmer ».
 */
async function autoLinkVehicle(
  admin: { from: (t: string) => any },
  emailId: string,
  e: IncomingEmail,
) {
  const plates = findPlates(
    [e.subject ?? "", e.bodyText ?? "", (e.attachments ?? []).map((a) => a.filename).join(" ")].join(" "),
  );
  if (!plates.length) return;
  const { data } = await admin
    .from("vehicles")
    .select("id, plate_normalized, client_id")
    .in("plate_normalized", plates);
  const rows = (data ?? []) as { id: string; plate_normalized: string | null; client_id: string | null }[];
  if (rows.length === 1) {
    const v = rows[0]!;
    await admin
      .from("emails")
      .update({
        vehicle_id: v.id,
        client_id: v.client_id,
        detected_plate: v.plate_normalized,
        link_status: "auto",
      })
      .eq("id", emailId);
    return;
  }
  await admin
    .from("emails")
    .update({ detected_plate: plates[0] ?? null, link_status: "a_confirmer" })
    .eq("id", emailId);
}
