/** Envoi du document A4 validé vers la comptabilité de l'établissement. */
import { brandedEmail, sendEmailWithAttachments } from "./email.server";

export type ExpenseMailInput = {
  to: string;
  personal: boolean;
  onAccount?: boolean;
  accountLabel?: string;
  amount: string;
  merchant: string;
  siteLabel: string;
  spentOn: string;
  purpose: string;
  paymentLabel: string;
  authorName: string;
  validatorName: string;
  pdfBase64: string;
  filename: string;
  idempotencyKey: string;
};

export async function sendExpenseToAccounting(input: ExpenseMailInput) {
  const subject = input.personal
    ? `Remboursement à effectuer — ${input.authorName} — ${input.amount} — ${input.siteLabel}`
    : input.onAccount
      ? `En compte — justificatif à rapprocher — ${input.authorName} — ${input.amount} — ${input.siteLabel}`
      : `Justificatif à comptabiliser — déjà réglé — ${input.authorName} — ${input.amount} — ${input.siteLabel}`;

  const banner = input.personal
    ? `<p style="background:#fde047;color:#1a1a1a;padding:10px 14px;font-weight:700;margin:0 0 16px 0;">REMBOURSEMENT À EFFECTUER (paiement personnel du salarié)</p>`
    : input.onAccount
      ? `<p style="background:#dbeafe;color:#1a1a1a;padding:10px 14px;font-weight:700;margin:0 0 16px 0;">EN COMPTE — JUSTIFICATIF À RAPPROCHER DU RELEVÉ / DE LA FACTURE</p>`
      : `<p style="background:#e4e4e7;color:#1a1a1a;padding:10px 14px;font-weight:700;margin:0 0 16px 0;">DÉJÀ RÉGLÉ — JUSTIFICATIF À COMPTABILISER</p>`;

  const rows: [string, string][] = [
    ["Établissement", input.siteLabel],
    ["Salarié", input.authorName],
    ["Date de la dépense", input.spentOn],
    ["Fournisseur", input.merchant],
    ["Motif", input.purpose],
    ["Moyen de règlement", input.paymentLabel],
    ...(input.onAccount ? ([["Carte / compte utilisé", input.accountLabel || "—"]] as [string, string][]) : []),
    ["Montant TTC", input.amount],
    ["Validée par", input.validatorName],
  ];


  const table = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#71717a;font-size:14px;">${esc(k)}</td><td style="padding:4px 0;font-size:14px;font-weight:700;">${esc(v)}</td></tr>`,
    )
    .join("");

  const html = brandedEmail(
    `<h1 style="margin:0 0 16px 0;font-size:20px;">Note de frais validée</h1>${banner}<table>${table}</table>
     <p style="font-size:13px;color:#71717a;margin-top:18px;">Document A4 avec justificatif joint à cet e-mail.</p>`,
    { preview: subject },
  );

  const res = await sendEmailWithAttachments({
    to: input.to,
    subject,
    html,
    attachments: [{ filename: input.filename, content: input.pdfBase64 }],
    idempotencyKey: input.idempotencyKey,
  });
  return { ok: res.ok, error: res.error ?? "", subject };
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
