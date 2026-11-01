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

/** Identité toujours imprimée (texte), même si le logo est indisponible. */
export const PDF_IDENTITY = { name: "Damien DIGOIN Automobile", tagline: "LE SENS DU SERVICE" } as const;

export const PDF_PAGE = { W: 595.28, H: 841.89, M: 48, headerBottom: 841.89 - 114, footerTop: 90, previewFooterTop: 150 } as const;

/** Découpe en lignes ≤ maxWidth ; un mot plus long que la largeur est coupé par caractères. */
export function wrapText(s: string, maxWidth: number, measure: (t: string) => number): string[] {
  const out: string[] = [];
  let line = "";
  const pushLong = (w: string) => {
    let chunk = "";
    for (const ch of w) {
      if (chunk && measure(chunk + ch) > maxWidth) { out.push(chunk); chunk = ch; } else chunk += ch;
    }
    return chunk;
  };
  for (const w of s.split(/\s+/).filter(Boolean)) {
    const t = line ? `${line} ${w}` : w;
    if (measure(t) <= maxWidth) { line = t; continue; }
    if (line) out.push(line);
    line = measure(w) <= maxWidth ? w : pushLong(w);
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

/** Élément positionné (exposé pour les tests de mise en page). */
export type PdfLayoutItem = { page: number; kind: "text" | "box"; text?: string; x: number; y: number; width: number; height: number };

export async function buildCommercialPdf(
  d: CommercialPdfData,
  logo: { renault: Uint8Array | null },
  layoutOut?: PdfLayoutItem[],
): Promise<Uint8Array> {
  if (d.offer.status !== "available" || d.offer.totalTtcCents == null) throw new Error("offer_unavailable");
  const pdf = await PDFDocument.create();
  pdf.setTitle(winAnsi(`Devis pneumatiques ${d.reference}`));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { W, H, M } = PDF_PAGE;
  const CW = W - 2 * M;
  const bottom = d.preview ? PDF_PAGE.previewFooterTop : PDF_PAGE.footerTop;
  const ink = rgb(0.1, 0.1, 0.1), muted = rgb(0.4, 0.4, 0.4), accent = rgb(0.98, 0.78, 0.0), white = rgb(1, 1, 1);
  let logoImg: Awaited<ReturnType<typeof pdf.embedJpg>> | null = null;
  if (logo.renault) {
    try { logoImg = await pdf.embedJpg(logo.renault); } catch { logoImg = null; }
  }
  const log = (it: PdfLayoutItem) => layoutOut?.push(it);
  let pageNo = 0;
  let page = pdf.addPage([W, H]);
  let y = 0;

  const header = () => {
    page.drawRectangle({ x: 0, y: H - 110, width: W, height: 110, color: rgb(0, 0, 0) });
    if (logoImg) {
      const r = logoImg.height / logoImg.width;
      const w = Math.min(150, 80 / r), h = w * r;
      page.drawImage(logoImg, { x: M, y: H - 55 - h / 2, width: w, height: h });
    }
    const rx = W - M - 250;
    page.drawText(winAnsi("Devis pneumatiques — DDA Care"), { x: rx, y: H - 45, size: 15, font: bold, color: white });
    page.drawText(winAnsi(PDF_IDENTITY.name), { x: rx, y: H - 68, size: 12, font: bold, color: white });
    page.drawText(winAnsi(PDF_IDENTITY.tagline), { x: rx, y: H - 86, size: 9, font: bold, color: accent });
    log({ page: pageNo, kind: "text", text: PDF_IDENTITY.name, x: rx, y: H - 68, width: 0, height: 12 });
    log({ page: pageNo, kind: "text", text: PDF_IDENTITY.tagline, x: rx, y: H - 86, width: 0, height: 9 });
    page.drawRectangle({ x: 0, y: H - 114, width: W, height: 4, color: accent });
    y = H - 150;
  };
  const footer = () => {
    if (d.preview) page.drawText(winAnsi("APERÇU — NON ENVOYÉ"), { x: M, y: 110, size: 28, font: bold, color: rgb(0.85, 0.85, 0.85) });
    page.drawText(winAnsi(SIGNATURE), { x: M, y: 60, size: 10, font: bold, color: ink });
    page.drawText(`${pageNo + 1}`, { x: W - M - 10, y: 60, size: 9, font, color: muted });
  };
  const newPage = () => { footer(); page = pdf.addPage([W, H]); pageNo++; header(); };
  const ensure = (h: number) => { if (y - h < bottom) newPage(); };

  type F = typeof font;
  const text = (s: string, o: { size?: number; f?: F; c?: typeof ink; gap?: number } = {}) => {
    const size = o.size ?? 10.5, f = o.f ?? font, lh = size + 4;
    for (const ln of wrapText(winAnsi(s), CW, (t) => f.widthOfTextAtSize(t, size))) {
      ensure(lh);
      page.drawText(ln, { x: M, y, size, font: f, color: o.c ?? ink });
      log({ page: pageNo, kind: "text", text: ln, x: M, y, width: f.widthOfTextAtSize(ln, size), height: size });
      y -= lh;
    }
    y -= (o.gap ?? 6) - 4;
  };
  const section = (t: string) => { y -= 6; ensure(9 + 4 + 20); text(t.toUpperCase(), { size: 9, f: bold, c: muted, gap: 4 }); };

  header();
  const lines = commercialPdfLines(d);
  text(lines[0]!, { size: 13, f: bold });
  text(lines[1]!);
  text(lines[2]!, { f: bold, gap: 12 });
  section("Client");
  text(lines[3]!); text(lines[4]!); text(lines[5]!, { gap: 10 });
  section("Garage");
  text(lines[6]!, { gap: 10 });
  section("Offre retenue");
  text(lines[7]!, { size: 13, f: bold });
  text(lines[8]!); text(lines[9]!); text(lines[10]!, { gap: 6 });

  // Bloc total : encadré dimensionné sur son contenu, sous la dernière ligne (aucun recouvrement).
  const tSize = 16, pad = 10;
  const tLines = wrapText(winAnsi(lines[11]!), CW - 2 * pad, (t) => bold.widthOfTextAtSize(t, tSize));
  const boxH = pad * 2 + tLines.length * (tSize + 4) - 4;
  y -= 8; // marge au-dessus de l'encadré
  ensure(boxH + 12);
  const boxTop = y;
  page.drawRectangle({ x: M, y: boxTop - boxH, width: CW, height: boxH, color: rgb(0.96, 0.96, 0.96) });
  log({ page: pageNo, kind: "box", x: M, y: boxTop - boxH, width: CW, height: boxH });
  let ty = boxTop - pad - tSize * 0.8;
  for (const ln of tLines) {
    page.drawText(ln, { x: M + pad, y: ty, size: tSize, font: bold, color: ink });
    log({ page: pageNo, kind: "text", text: ln, x: M + pad, y: ty, width: bold.widthOfTextAtSize(ln, tSize), height: tSize });
    ty -= tSize + 4;
  }
  y = boxTop - boxH - 18;

  section("Réserve");
  text(lines[12]!, { c: muted });
  if (d.offer.compatibilityMessage) text(d.offer.compatibilityMessage, { c: muted });
  footer();
  return pdf.save();
}
