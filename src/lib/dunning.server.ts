import { brandedEmail, sendEmail } from "./email.server";

type Row = Record<string, unknown>;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const eur = (v: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);

const PARTS = [
  ["insurer", "Assureur"],
  ["franchise", "Franchise"],
  ["depreciation", "Vétusté"],
  ["vat", "TVA"],
  ["other", "Autre"],
] as const;

export type DunningInput = {
  caseId: string;
  to: string;
  message?: string;
  authorName?: string;
};

/**
 * Envoie une relance de créance pour un dossier carrosserie et journalise
 * l'envoi dans bodyshop_communications (service role : appelée côté serveur).
 */
export async function sendDunningEmail(input: DunningInput): Promise<{ ok: boolean; error?: string; outstanding: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data, error } = await supabaseAdmin
    .from("bodyshop_cases")
    .select(
      "id, plate, or_number, claim_number, customer_name, mission_date, closed_at, created_at, amount_total_ttc, amount_insurer_expected, amount_insurer_received, amount_franchise_expected, amount_franchise_received, amount_depreciation_expected, amount_depreciation_received, amount_vat_expected, amount_vat_received, amount_other_expected, amount_other_received",
    )
    .eq("id", input.caseId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, error: "Dossier introuvable", outstanding: 0 };

  const c = data as Row;
  const lines = PARTS.map(([key, label]) => ({
    label,
    outstanding: Math.max(0, num(c[`amount_${key}_expected`]) - num(c[`amount_${key}_received`])),
  })).filter((l) => l.outstanding > 0.5);
  const outstanding = lines.reduce((s, l) => s + l.outstanding, 0);
  if (outstanding <= 0.5) return { ok: false, error: "Aucun encours à relancer sur ce dossier", outstanding: 0 };

  const ref = (c["closed_at"] as string | null) || (c["mission_date"] as string | null) || (c["created_at"] as string);
  const days = Math.max(0, Math.floor((Date.now() - new Date(ref).getTime()) / 86_400_000));
  const label = String(c["plate"] || c["or_number"] || "Dossier carrosserie");
  const subject = `Relance règlement — dossier ${label} (${eur(outstanding)})`;

  const detail = lines
    .map(
      (l) =>
        `<tr><td style="padding:6px 0;font-size:14px;">${esc(l.label)}</td><td style="padding:6px 0;text-align:right;font-weight:700;font-size:14px;">${eur(l.outstanding)}</td></tr>`,
    )
    .join("");

  const html = brandedEmail(
    `<h1 style="margin:0 0 12px 0;font-size:20px;">Relance de règlement</h1>
     <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">Bonjour${c["customer_name"] ? ` ${esc(String(c["customer_name"]))}` : ""},</p>
     <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">Sauf erreur de notre part, le règlement du dossier <strong>${esc(label)}</strong>${c["claim_number"] ? ` (sinistre ${esc(String(c["claim_number"]))})` : ""} reste en attente depuis <strong>${days} jours</strong>.</p>
     ${input.message ? `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">${esc(input.message)}</p>` : ""}
     <table role="presentation" width="100%" style="border-top:1px solid #e4e4e7;margin:8px 0 16px 0;">${detail}
       <tr><td style="padding:10px 0;border-top:1px solid #e4e4e7;font-weight:800;">Total dû</td><td style="padding:10px 0;border-top:1px solid #e4e4e7;text-align:right;font-weight:800;">${eur(outstanding)}</td></tr>
     </table>
     <p style="margin:0 0 8px 0;font-size:14px;line-height:1.6;color:#52525b;">Si ce règlement a déjà été effectué, merci de ne pas tenir compte de ce message.</p>`,
    { preview: `Encours ${eur(outstanding)} — dossier ${label}` },
  );

  const res = await sendEmail({ to: input.to, subject, html, idempotencyKey: `dunning-${input.caseId}-${new Date().toISOString().slice(0, 10)}` });

  await supabaseAdmin.from("bodyshop_communications").insert({
    case_id: input.caseId,
    channel: "email",
    template_key: "relance_creance",
    recipient: input.to,
    subject,
    body: `Encours ${eur(outstanding)} — ${days} j${input.message ? ` — ${input.message}` : ""}`,
    status: res.ok ? "envoye" : "echec",
    error_message: res.ok ? null : (res.error ?? "Envoi impossible"),
    sent_at: res.ok ? new Date().toISOString() : null,
    created_by_name: input.authorName ?? "Automatisation",
  } as never);

  return { ok: res.ok, ...(res.error ? { error: res.error } : {}), outstanding };
}
