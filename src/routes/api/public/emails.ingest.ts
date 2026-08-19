import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { categorizeEmail, emailFingerprint, messageKind, threadKeyOf } from "@/lib/emails-core";

const schema = z.object({
  rfcMessageId: z.string().nullish(),
  gmailMessageId: z.string().nullish(),
  gmailThreadId: z.string().nullish(),
  sentAt: z.string(),
  from: z.string(),
  fromName: z.string().nullish(),
  to: z.array(z.string()).default([]),
  cc: z.array(z.string()).default([]),
  subject: z.string().nullish(),
  bodyText: z.string().nullish(),
  bodyHtml: z.string().nullish(),
  mailbox: z.string(),
  personName: z.string().nullish(),
  attachments: z
    .array(z.object({ filename: z.string(), mimeType: z.string().nullish(), sizeBytes: z.number().nullish() }))
    .default([]),
});

/** Réception des emails collectés depuis les boîtes Gmail connectées (connecteur / agent). */
export const Route = createFileRoute("/api/public/emails/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = request.headers.get("apikey");
        const expected =
          process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"] ?? null;
        if (!expected || !apiKey || apiKey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        const parsed = schema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ ok: false, error: "Payload invalide" }, { status: 400 });
        }
        const e = parsed.data;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const fingerprint = emailFingerprint({
          rfcMessageId: e.rfcMessageId ?? null,
          from: e.from,
          subject: e.subject ?? null,
          sentAt: e.sentAt,
          body: e.bodyText ?? e.bodyHtml ?? null,
        });

        const existing = await supabaseAdmin.from("emails").select("id").eq("fingerprint", fingerprint).maybeSingle();
        let emailId = existing.data?.id ?? null;
        const duplicate = !!emailId;

        if (!emailId) {
          const cat = categorizeEmail({ subject: e.subject, body: e.bodyText ?? e.bodyHtml, from: e.from });
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
              to_addresses: e.to,
              cc_addresses: e.cc,
              subject: e.subject ?? null,
              snippet: (e.bodyText ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null,
              body_text: e.bodyText ?? null,
              body_html: e.bodyHtml ?? null,
              kind: messageKind(e.subject),
              category: cat.category,
              category_confidence: cat.confidence,
              has_attachments: e.attachments.length > 0,
            })
            .select("id")
            .single();
          if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
          emailId = data.id;
          if (e.attachments.length) {
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

        const account = await supabaseAdmin
          .from("email_accounts")
          .select("id")
          .eq("address", e.mailbox.toLowerCase())
          .maybeSingle();

        await supabaseAdmin.from("email_receipts").upsert(
          {
            email_id: emailId,
            account_id: account.data?.id ?? null,
            mailbox_address: e.mailbox.toLowerCase(),
            person_name: e.personName ?? null,
            gmail_message_id: e.gmailMessageId ?? null,
          },
          { onConflict: "email_id,mailbox_address" },
        );

        if (account.data?.id) {
          await supabaseAdmin
            .from("email_accounts")
            .update({ status: "connected", last_sync_at: new Date().toISOString(), last_error: null })
            .eq("id", account.data.id);
        }

        return Response.json({ ok: true, emailId, duplicate });
      },
    },
  },
});
