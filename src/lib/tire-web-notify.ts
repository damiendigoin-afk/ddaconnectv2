/**
 * E-mail interne au front office du garage choisi pour une demande de RDV pneus.
 * Contient uniquement le prix TTC client du devis (jamais prix d'achat ni fournisseur).
 */
import type { WebQuoteCase } from "./tire-web-api";

export type FrontOfficeSite = { id: string; contact_email: string | null };

const TIER = { entree: "Entrée de gamme", milieu: "Milieu de gamme", haut: "Haut de gamme" } as const;
const SEASON = { ete: "Été", quatre_saisons: "4 saisons" } as const;
const PERIOD = { matin: "matin", apres_midi: "après-midi" } as const;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const eur = (cents: number | null) => (cents == null ? "—" : `${(cents / 100).toFixed(2).replace(".", ",")} € TTC`);

export function buildFrontOfficeEmail(args: {
  requestId: string;
  siteLabel: string;
  request: {
    name: string;
    phone?: string | undefined;
    email?: string | undefined;
    plate?: string | undefined;
    message?: string | undefined;
    preferredSlots: { date: string; period: "matin" | "apres_midi" }[];
    offer: WebQuoteCase;
    createdAt: Date;
  };
}): { subject: string; html: string } {
  const r = args.request;
  const o = r.offer;
  const tyre = [o.brand, o.model].filter(Boolean).join(" ");
  const dims = [o.size, `${o.loadIndex ?? ""}${o.speedIndex ?? ""}`].filter((x) => x && x.trim()).join(" ");
  const slots = r.preferredSlots
    .map((s) => `${s.date.split("-").reverse().join("/")} ${PERIOD[s.period]}`)
    .join(", ");
  const row = (k: string, v: string | undefined | null) =>
    v ? `<tr><td style="padding:4px 12px 4px 0;color:#555;">${esc(k)}</td><td style="padding:4px 0;"><b>${esc(v)}</b></td></tr>` : "";
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;">
<h2 style="margin:0 0 8px 0;">Nouvelle demande de rendez-vous pneus — à confirmer</h2>
<p style="margin:0 0 16px 0;">Garage choisi par le client : <b>${esc(args.siteLabel)}</b>. Il s'agit d'une demande, aucun rendez-vous n'est réservé : merci de recontacter le client.</p>
<table style="border-collapse:collapse;">
${row("Client", r.name)}${row("Téléphone", r.phone)}${row("E-mail", r.email)}${row("Immatriculation", r.plate)}
${row("Créneaux souhaités", slots)}
${row("Pneus", `${tyre} — ${TIER[o.tier]} ${SEASON[o.season]}`)}${row("Dimension", dims)}
${row("Quantité", String(o.quantity))}${row("Total devis", eur(o.totalTtcCents))}
${row("Prestations", o.includedServices.map((s) => s.label).join(", ") || undefined)}
${row("Compatibilité", o.compatibilityMessage)}
${row("Message", r.message)}
</table>
<p style="margin:16px 0 0 0;color:#777;font-size:12px;">Demande n° ${esc(args.requestId)} reçue le ${esc(r.createdAt.toISOString().slice(0, 16).replace("T", " "))} UTC via le site DDA Pneus. Prix public du devis en ligne, valable sous réserve de confirmation.</p>
</div>`;
  return { subject: `Demande RDV pneus à confirmer — ${r.name}`.slice(0, 150), html };
}
