/** Envois e-mail transverses (expert, fournisseur, client) pour Carrosserie et Magasin. */
import { brandedEmail, sendEmail } from "./email.server";

export async function sendModuleEmail(input: {
  to: string;
  subject: string;
  body: string;
  kind: string;
  links?: { label: string; url: string }[];
}) {
  const paragraphs = input.body
    .split("\n")
    .map((l) => (l.trim() ? `<p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;">${escapeHtml(l)}</p>` : "<br/>"))
    .join("");
  const links = (input.links ?? [])
    .map(
      (l) =>
        `<p style="margin:0 0 8px 0;font-size:14px;"><a href="${l.url}" style="color:#1a1a1a;">${escapeHtml(l.label)}</a></p>`,
    )
    .join("");
  const res = await sendEmail({
    to: input.to,
    subject: input.subject,
    html: brandedEmail(
      `<h1 style="margin:0 0 16px 0;font-size:20px;">${escapeHtml(input.subject)}</h1>${paragraphs}${links}`,
      { preview: input.subject },
    ),
  });
  return { ok: res.ok, error: res.error ?? "" };
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
