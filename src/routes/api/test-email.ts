import { createFileRoute } from "@tanstack/react-router";
import { sendEmail, brandedEmail } from "@/lib/email.server";

/**
 * One-off test endpoint to verify Resend is wired correctly.
 * GET /api/test-email?to=...  -> sends a branded test email.
 *
 * Gated by LOVABLE_API_KEY so it cannot be triggered by anonymous visitors
 * on the published site.
 */
export const Route = createFileRoute("/api/test-email")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const auth = request.headers.get("authorization") ?? "";
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey || auth !== `Bearer ${apiKey}`) {
          return new Response("Unauthorized", { status: 401 });
        }

        const to = (url.searchParams.get("to") ?? "").trim();
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRe.test(to)) {
          return Response.json(
            { ok: false, error: "Invalid or missing 'to' email" },
            { status: 400 },
          );
        }

        const html = brandedEmail(
          `
            <h1 style="margin:0 0 16px 0;font-size:22px;color:#1a1a1a;">Email de test ✅</h1>
            <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#3f3f46;">
              Bonjour,<br /><br />
              Cet email confirme que l'envoi de courriels via <strong>Resend</strong>
              est opérationnel pour Garage Castillon.
              Les notifications de l'application (confirmations, rapports, etc.)
              utiliseront ce canal.
            </p>
            <p style="margin:24px 0 0 0;font-size:13px;color:#71717a;">
              Destinataire du test&nbsp;: ${to}
            </p>
          `,
          { preview: "Configuration email Garage Castillon vérifiée" },
        );

        const result = await sendEmail({
          to,
          subject: "[Garage Castillon] Email de test — Resend opérationnel",
          html,
          replyTo: "contact@garagecastillon.fr",
          idempotencyKey: `test-email-${to}`,
        });

        return Response.json(result, { status: result.ok ? 200 : 502 });
      },
    },
  },
});
