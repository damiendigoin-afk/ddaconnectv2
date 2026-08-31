import { createHmac } from "crypto";

/**
 * Server-only email sender using the Resend API.
 *
 * Calls Resend's REST API directly with the project-scoped RESEND_API_KEY
 * secret. The sender domain (garagecastillon.fr) is verified in the Resend
 * account, so production sends to real recipients work out of the box.
 *
 * This module is server-only: import it only inside server functions or
 * server route handlers. Never import it from client code.
 */

export const FROM_DEFAULT = "Damien Digoin Automobile <contact@garagecastillon.fr>";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  /** Optional idempotency key to prevent duplicate sends on retry. */
  idempotencyKey?: string;
}

/** Pièce jointe Resend : contenu encodé en base64. */
export interface EmailAttachment {
  filename: string;
  content: string;
}

export interface SendEmailResult {
  ok: boolean;
  id?: string | undefined;
  status: number;
  error?: string | undefined;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  return sendEmailWithAttachments({ ...input, attachments: [] });
}

export async function sendEmailWithAttachments(
  input: SendEmailInput & { attachments?: EmailAttachment[] },
): Promise<SendEmailResult> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    return { ok: false, status: 0, error: "RESEND_API_KEY is not configured" };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (input.idempotencyKey) {
    headers["Idempotency-Key"] = input.idempotencyKey;
  }

  const body: Record<string, unknown> = {
    from: input.from ?? FROM_DEFAULT,
    to: [input.to],
    subject: input.subject,
    html: input.html,
  };
  if (input.replyTo) body["reply_to"] = input.replyTo;
  if (input.attachments?.length) body["attachments"] = input.attachments;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, error: text };
  }

  let id: string | undefined;
  try {
    id = JSON.parse(text).id;
  } catch {
    /* ignore parse errors */
  }
  if (!id) {
    return {
      ok: false,
      status: res.status,
      error: "Le fournisseur a répondu sans identifiant d'envoi",
    };
  }
  return { ok: true, status: res.status, id };
}

/**
 * Build a branded HTML email body wrapping arbitrary inner content.
 * Brand colors: dark charcoal (#1a1a1a) background accents + Renault-style
 * yellow (#FFCC00) highlights, matching the app's --accent token.
 */
export function brandedEmail(innerHtml: string, opts?: { preview?: string }): string {
  const preview = opts?.preview ?? "";
  return `<!DOCTYPE html>
<html lang="fr" dir="ltr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Damien Digoin Automobile</title>
    ${preview ? `<style>@media (max-width: 600px){.preview{display:none!important}}</style>` : ""}
  </head>
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1a1a1a;">
    ${preview ? `<div class="preview" style="display:none;max-height:0;overflow:hidden;opacity:0;">${preview}</div>` : ""}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#1a1a1a;">
      <tr>
        <td align="center" style="padding:24px 0;">
          <span style="font-size:20px;font-weight:800;letter-spacing:0.5px;color:#ffffff;">
            GARAGE <span style="color:#FFCC00;">CASTILLON</span>
          </span>
        </td>
      </tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;">
            <tr><td style="padding:32px 32px 8px 32px;">${innerHtml}</td></tr>
          </table>
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
            <tr><td align="center" style="padding:20px 16px 8px 16px;font-size:12px;color:#71717a;line-height:1.5;">
              Damien Digoin Automobile &middot; Atelier automobile<br />
              Cet email est envoyé automatiquement, merci de ne pas y répondre.
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Helper to build a primary CTA button row. */
export function emailButton(label: string, href: string): string {
  const qs = `?subject=Réponse&body=Bonjour`;
  return `<a href="${href}" style="display:inline-block;background-color:#FFCC00;color:#1a1a1a;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:15px;">${label}</a>`;
}

export { createHmac };
