import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

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
        const { ingestEmailServer } = await import("@/lib/emails-ingest.server");

        const account = await supabaseAdmin
          .from("email_accounts")
          .select("id, site_id")
          .eq("address", e.mailbox.toLowerCase())
          .maybeSingle();

        try {
          const res = await ingestEmailServer({
            rfcMessageId: e.rfcMessageId ?? null,
            gmailMessageId: e.gmailMessageId ?? null,
            gmailThreadId: e.gmailThreadId ?? null,
            sentAt: e.sentAt,
            from: e.from,
            fromName: e.fromName ?? null,
            to: e.to,
            cc: e.cc,
            subject: e.subject ?? null,
            bodyText: e.bodyText ?? null,
            bodyHtml: e.bodyHtml ?? null,
            mailbox: e.mailbox,
            personName: e.personName ?? null,
            accountId: account.data?.id ?? null,
            siteId: account.data?.site_id ?? null,
            attachments: e.attachments.map((a) => ({
              filename: a.filename,
              mimeType: a.mimeType ?? null,
              sizeBytes: a.sizeBytes ?? null,
            })),
          });

          if (account.data?.id) {
            await supabaseAdmin
              .from("email_accounts")
              .update({ status: "connected", last_sync_at: new Date().toISOString(), last_error: null })
              .eq("id", account.data.id);
          }

          return Response.json({ ok: true, emailId: res.emailId, duplicate: res.duplicate });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Ingestion impossible";
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
