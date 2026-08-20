/**
 * E-mails du module Magasin / Retours fournisseurs.
 * Toujours envoyés côté serveur, avec lien sécurisé vers le portail fournisseur.
 */
import { brandedEmail, emailButton, sendEmail } from "./email.server";
import { publicOrigin } from "./public-url.server";

type Kind = "accord" | "expedition" | "reception" | "relance" | "escalade";

const SUBJECTS: Record<Kind, (ref: string) => string> = {
  accord: (r) => `Demande d'accord de retour — ${r}`,
  expedition: (r) => `Retour expédié — ${r}`,
  reception: (r) => `Confirmation de réception du retour — ${r}`,
  relance: (r) => `Relance retour — ${r}`,
  escalade: (r) => `Escalade retour sans réponse — ${r}`,
};

export type ReturnMailInput = {
  kind: Kind;
  to: string;
  reference: string;
  supplierName?: string | null;
  plate?: string | null;
  orNumber?: string | null;
  blNumber?: string | null;
  invoiceNumber?: string | null;
  documentDate?: string | null;
  lines: { reference?: string | null; label?: string | null; quantity?: number | null; unitPrice?: number | null }[];
  amount?: number | null;
  reason?: string | null;
  handover?: string | null;
  extra?: string | null;
  shareToken?: string | null;
};

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function intro(kind: Kind, input: ReturnMailInput): string {
  switch (kind) {
    case "accord":
      return "Nous souhaitons procéder au retour des pièces ci-dessous. Merci de nous indiquer votre accord et la procédure à suivre.";
    case "expedition":
      return `Le retour référencé ci-dessous a été ${input.handover ? `remis (${input.handover})` : "expédié"}. Merci de nous confirmer sa bonne réception.`;
    case "reception":
      return "Sans nouvelle de votre part, nous vous remercions de confirmer la réception de ce retour et le traitement de l'avoir.";
    case "relance":
      return "Sauf erreur de notre part, ce dossier de retour est toujours en attente de votre réponse.";
    case "escalade":
      return "Ce dossier de retour reste sans réponse malgré nos relances. Merci de votre intervention.";
  }
}

function table(input: ReturnMailInput): string {
  const rows = input.lines
    .map(
      (l) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:14px;">${esc(l.reference ?? "—")}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:14px;">${esc(l.label ?? "—")}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:14px;text-align:right;">${l.quantity ?? 1}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:14px;text-align:right;">${l.unitPrice != null ? `${Number(l.unitPrice).toFixed(2)} €` : "—"}</td></tr>`,
    )
    .join("");
  return `<table style="width:100%;border-collapse:collapse;margin:12px 0;">
    <thead><tr>
      <th style="text-align:left;font-size:12px;text-transform:uppercase;padding:6px 8px;">Référence</th>
      <th style="text-align:left;font-size:12px;text-transform:uppercase;padding:6px 8px;">Désignation</th>
      <th style="text-align:right;font-size:12px;text-transform:uppercase;padding:6px 8px;">Qté</th>
      <th style="text-align:right;font-size:12px;text-transform:uppercase;padding:6px 8px;">PU</th>
    </tr></thead><tbody>${rows || `<tr><td colspan="4" style="padding:8px;font-size:14px;">—</td></tr>`}</tbody></table>`;
}

export async function sendReturnMail(input: ReturnMailInput) {
  const origin = publicOrigin();
  const subject = SUBJECTS[input.kind](input.reference);
  const facts: [string, string | null | undefined][] = [
    ["Référence dossier", input.reference],
    ["Document", [input.blNumber ? `BL ${input.blNumber}` : "", input.invoiceNumber ? `Facture ${input.invoiceNumber}` : ""].filter(Boolean).join(" · ") || null],
    ["Date du document", input.documentDate],
    ["Immatriculation", input.plate],
    ["N° OR", input.orNumber],
    ["Motif", input.reason],
    ["Montant attendu", input.amount != null ? `${Number(input.amount).toFixed(2)} €` : null],
  ];
  const factsHtml = facts
    .filter(([, v]) => v)
    .map(([k, v]) => `<p style="margin:0 0 4px 0;font-size:14px;"><strong>${esc(k)} :</strong> ${esc(String(v))}</p>`)
    .join("");

  const link = input.shareToken ? `${origin}/retour-fournisseur/${input.shareToken}` : "";
  const cta = link
    ? emailButton("Répondre en ligne", link) +
      `<p style="margin:8px 0 0 0;font-size:12px;color:#666;">Ce lien vous permet de répondre et de déposer un accord, un BL ou un avoir sans créer de compte.</p>`
    : "";

  const html = brandedEmail(
    `<h1 style="margin:0 0 12px 0;font-size:20px;">${esc(subject)}</h1>
     <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;">Bonjour${input.supplierName ? ` ${esc(input.supplierName)}` : ""},</p>
     <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;">${esc(intro(input.kind, input))}</p>
     ${factsHtml}
     ${table(input)}
     ${input.extra ? `<p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;">${esc(input.extra)}</p>` : ""}
     ${cta}
     <p style="margin:16px 0 0 0;font-size:14px;">Cordialement,<br/>Service Magasin</p>`,
    { preview: subject },
  );

  const res = await sendEmail({ to: input.to, subject, html });
  return { ok: res.ok, error: res.error ?? "", subject, link };
}
