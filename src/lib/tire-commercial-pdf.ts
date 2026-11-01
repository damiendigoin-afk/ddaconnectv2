/**
 * PDF A4 du devis commercial DDA Care (pdf-lib, exécutable côté serveur).
 * Le total affiché est EXACTEMENT celui du devis Top prix (aucune ventilation).
 * Aucune mention de compatibilité définitive : le véhicule n'est pas vérifié.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import type { WebQuoteCase } from "./tire-web-api";
import { COMMERCIAL_VALIDITY_DAYS, SEASON_LABEL, SIGNATURE, TIER_LABEL, eurCents, formatParisDate, totalLabel } from "./tire-v10";

export type CommercialPdfData = {
  reference: string;
  issuedAt: Date;
  validUntil: Date;
  customer: { name: string; email: string; phone: string };
  garageLabel: string;
  offer: WebQuoteCase;
  preview?: boolean;
};

export const COMPATIBILITY_RESERVE =
  "Compatibilité avec votre véhicule à confirmer par le garage : le véhicule n'a pas encore été vérifié.";

/** Helvetica = WinAnsi : remplace les caractères hors jeu. */
export function winAnsi(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[—–]/g, "-")
    .replace(/[•·]/g, "-")
    .replace(/\u202F|\u00A0/g, " ")
    .replace(/[^\x20-\x7E\u00A0-\u00FF€]/g, "");
}

/** Lignes réellement affichées (exposées pour les tests). */
export function commercialPdfLines(d: CommercialPdfData): string[] {
  const o = d.offer;
  const services = o.includedServices.length ? o.includedServices.map((s) => s.label).join(", ") : "Aucune prestation incluse indiquée";
  return [
    `Devis n° ${d.reference}`,
    `Date : ${formatParisDate(d.issuedAt)}`,
    `Valable ${COMMERCIAL_VALIDITY_DAYS} jours, jusqu'au ${formatParisDate(d.validUntil)}, sous réserve de disponibilité.`,
    `Client : ${d.customer.name}`,
    `E-mail : ${d.customer.email}`,
    `Téléphone : ${d.customer.phone}`,
    `Garage : ${d.garageLabel}`,
    `${o.brand ?? ""} ${o.model ?? ""}`.trim(),
    `${o.size ?? ""} ${o.loadIndex ?? ""}${o.speedIndex ?? ""} · ${SEASON_LABEL[o.season]} · ${TIER_LABEL[o.tier]}`,
    `Quantité : ${o.quantity}`,
    `Prestations incluses : ${services}`,
    `${totalLabel(o)} : ${eurCents(o.totalTtcCents ?? 0)}`,
    COMPATIBILITY_RESERVE,
    ...(o.compatibilityMessage ? [o.compatibilityMessage] : []),
    SIGNATURE,
  ];
}

export async function buildCommercialPdf(d: CommercialPdfData, logo: { renault: Uint8Array | null }): Promise<Uint8Array> {
  if (d.offer.status !== "available" || d.offer.totalTtcCents == null) throw new Error("offer_unavailable");
  const pdf = await PDFDocument.create();
  pdf.setTitle(winAnsi(`Devis pneumatiques ${d.reference}`));
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, M = 48;
  const ink = rgb(0.1, 0.1, 0.1), muted = rgb(0.4, 0.4, 0.4), accent = rgb(0.98, 0.78, 0.0);

  page.drawRectangle({ x: 0, y: 841.89 - 110, width: W, height: 110, color: rgb(0, 0, 0) });
  if (logo.renault) {
    try {
      const img = await pdf.embedJpg(logo.renault);
      const w = 170, h = (img.height / img.width) * w;
      page.drawImage(img, { x: M, y: 841.89 - 55 - h / 2, width: w, height: h });
    } catch {
      /* logo illisible : en-tête sans image */
    }
  }
  page.drawText(winAnsi("Devis pneumatiques — DDA Care"), { x: W - M - 230, y: 841.89 - 62, size: 15, font: bold, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 0, y: 841.89 - 114, width: W, height: 4, color: accent });

  const lines = commercialPdfLines(d);
  let y = 841.89 - 150;
  const text = (s: string, o: { size?: number; f?: typeof font; c?: typeof ink; gap?: number } = {}) => {
    const size = o.size ?? 10.5;
    // Retour à la ligne simple.
    const words = winAnsi(s).split(" ");
    let line = "";
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if ((o.f ?? font).widthOfTextAtSize(t, size) > W - 2 * M) {
        page.drawText(line, { x: M, y, size, font: o.f ?? font, color: o.c ?? ink });
        y -= size + 4;
        line = w;
      } else line = t;
    }
    if (line) page.drawText(line, { x: M, y, size, font: o.f ?? font, color: o.c ?? ink });
    y -= size + (o.gap ?? 6);
  };
  const section = (t: string) => {
    y -= 6;
    text(t.toUpperCase(), { size: 9, f: bold, c: muted, gap: 4 });
  };

  text(lines[0]!, { size: 13, f: bold });
  text(lines[1]!);
  text(lines[2]!, { f: bold, gap: 12 });
  section("Client");
  text(lines[3]!); text(lines[4]!); text(lines[5]!, { gap: 10 });
  section("Garage");
  text(lines[6]!, { gap: 10 });
  section("Offre retenue");
  text(lines[7]!, { size: 13, f: bold });
  text(lines[8]!); text(lines[9]!); text(lines[10]!, { gap: 14 });

  page.drawRectangle({ x: M, y: y - 14, width: W - 2 * M, height: 40, color: rgb(0.96, 0.96, 0.96) });
  y += 2;
  text(lines[11]!, { size: 16, f: bold, gap: 26 });

  section("Réserve");
  text(lines[12]!, { c: muted });
  if (d.offer.compatibilityMessage) text(d.offer.compatibilityMessage, { c: muted });

  if (d.preview) {
    page.drawText("APERÇU — NON ENVOYÉ", { x: M, y: 120, size: 28, font: bold, color: rgb(0.85, 0.85, 0.85) });
  }
  page.drawText(winAnsi(SIGNATURE), { x: M, y: 60, size: 10, font: bold, color: ink });
  return pdf.save();
}
