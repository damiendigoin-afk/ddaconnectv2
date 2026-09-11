/**
 * Devis pneus — génération d'un VRAI document PDF A4 (pdf-lib, déjà présent
 * dans le projet). Aucun calcul ici : seules les offres déjà chiffrées par le
 * moteur pneus partagé sont mises en page. Aucun prix d'achat ni marge n'est
 * imprimé.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import ddaRenaultLogo from "@/assets/dda-renault-logo.jpeg.asset.json";
import { GROUP_LABEL, siteHeader, type Site } from "@/lib/sites";
import { MOUNT_LABEL, type SevenOffer } from "@/lib/tires";

export type TireQuotePdfHeader = {
  site: Site | null;
  siteLabel: string;
  createdAt: string;
  userName: string | null;
  size: string;
  quantity: number;
  requestedBrand: string | null;
  customerName: string | null;
  plate: string | null;
  vehicleLabel: string | null;
  loadIndex: string | null;
  speedIndex: string | null;
};

const A4 = { w: 595.28, h: 841.89 };
const M = 40;
const INK = rgb(0.1, 0.1, 0.1);
const GREY = rgb(0.45, 0.45, 0.45);
const LINE = rgb(0.8, 0.8, 0.8);
const BAND = rgb(0.93, 0.93, 0.93);

function euro(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${Number(v).toFixed(2).replace(".", ",")} €`;
}

/** Helvetica ne connaît que WinAnsi : on remplace les caractères hors jeu. */
function safe(text: string): string {
  return text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[—–]/g, "-");
}

function clip(font: PDFFont, text: string, size: number, max: number): string {
  let out = safe(text);
  while (out.length > 1 && font.widthOfTextAtSize(out, size) > max) out = out.slice(0, -1);
  return out;
}

function draw(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  opts: { font: PDFFont; size: number; color?: typeof INK; maxWidth?: number },
) {
  const t = opts.maxWidth ? clip(opts.font, text, opts.size, opts.maxWidth) : safe(text);
  page.drawText(t, { x, y, size: opts.size, font: opts.font, color: opts.color ?? INK });
}

async function logoBytes(): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(ddaRenaultLogo.url);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

/** Document client A4, conçu pour tenir sur une page avec 6 ou 7 offres. */
export async function buildTireQuotePdf(
  header: TireQuotePdfHeader,
  offers: SevenOffer[],
): Promise<Blob> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Devis pneumatiques ${header.size}`);
  const page = pdf.addPage([A4.w, A4.h]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const h = siteHeader(header.site);
  const date = new Date(header.createdAt).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  let y = A4.h - M;

  /* En-tête : logo + garage à gauche, titre et date à droite. */
  const bytes = await logoBytes();
  if (bytes) {
    try {
      const img = await pdf.embedJpg(bytes);
      const w = 96;
      const ratio = img.height / img.width;
      page.drawImage(img, { x: M, y: y - w * ratio, width: w, height: w * ratio });
      y -= w * ratio + 8;
    } catch {
      /* Logo indisponible : le document reste valide sans image. */
    }
  }

  draw(page, header.site ? h.title : header.siteLabel || GROUP_LABEL, M, y, {
    font: bold,
    size: 11,
    maxWidth: 300,
  });
  let hy = y - 12;
  for (const line of h.lines) {
    draw(page, line, M, hy, { font: regular, size: 8, color: GREY, maxWidth: 300 });
    hy -= 10;
  }

  const rightX = A4.w - M;
  const title = "DEVIS PNEUMATIQUES";
  draw(page, title, rightX - bold.widthOfTextAtSize(title, 16), A4.h - M - 10, { font: bold, size: 16 });
  const dateW = regular.widthOfTextAtSize(date, 10);
  draw(page, date, rightX - dateW, A4.h - M - 26, { font: regular, size: 10 });
  if (header.userName) {
    const u = safe(header.userName);
    draw(page, u, rightX - regular.widthOfTextAtSize(u, 9), A4.h - M - 39, {
      font: regular,
      size: 9,
      color: GREY,
    });
  }

  y = Math.min(hy, A4.h - M - 60) - 12;
  page.drawLine({ start: { x: M, y }, end: { x: rightX, y }, thickness: 1.5, color: INK });
  y -= 20;

  /* Bloc d'informations. */
  const dimension = `${header.size}${
    header.loadIndex || header.speedIndex
      ? ` ${header.loadIndex ?? ""}${header.speedIndex ?? ""}`
      : ""
  }`;
  const info: [string, string][] = [
    ["Dimension", dimension],
    ["Quantité", `${header.quantity} pneu${header.quantity > 1 ? "s" : ""}`],
    ["Client", header.customerName || "—"],
    ["Véhicule", [header.vehicleLabel, header.plate].filter(Boolean).join(" · ") || "—"],
  ];
  if (header.requestedBrand) info.push(["Marque demandée", header.requestedBrand]);

  const colW = (rightX - M) / 2;
  info.forEach((pair, i) => {
    const x = M + (i % 2) * colW;
    const row = Math.floor(i / 2);
    const ry = y - row * 16;
    draw(page, pair[0].toUpperCase(), x, ry, { font: bold, size: 8, color: GREY });
    draw(page, pair[1], x + 88, ry, { font: bold, size: 10, maxWidth: colW - 96 });
  });
  y -= Math.ceil(info.length / 2) * 16 + 14;

  /* Tableau des propositions. */
  const cols = [
    { key: "title", label: "Proposition", x: M, w: 138 },
    { key: "brand", label: "Marque / modèle", x: M + 142, w: 190 },
    { key: "size", label: "Dimension", x: M + 336, w: 108 },
    { key: "price", label: "Prix TTC", x: rightX, w: 70 },
  ];

  page.drawRectangle({ x: M, y: y - 4, width: rightX - M, height: 18, color: BAND });
  cols.forEach((c) => {
    if (c.key === "price") {
      const w = bold.widthOfTextAtSize(c.label.toUpperCase(), 8);
      draw(page, c.label.toUpperCase(), rightX - w, y + 2, { font: bold, size: 8 });
    } else {
      draw(page, c.label.toUpperCase(), c.x, y + 2, { font: bold, size: 8 });
    }
  });
  y -= 18;

  for (const o of offers) {
    const rowH = 22;
    page.drawLine({ start: { x: M, y: y + 12 }, end: { x: rightX, y: y + 12 }, thickness: 0.5, color: LINE });
    draw(page, o.title, cols[0]!.x, y + 1, { font: bold, size: 9, maxWidth: cols[0]!.w });
    const label = o.available
      ? [o.brand, o.model].filter(Boolean).join(" ")
      : o.unavailableReason || "Non disponible";
    draw(page, label, cols[1]!.x, y + 1, {
      font: regular,
      size: 9,
      color: o.available ? INK : GREY,
      maxWidth: cols[1]!.w,
    });
    const dim = o.available
      ? [o.size, [o.loadIndex, o.speedIndex].filter(Boolean).join("")].filter(Boolean).join(" ")
      : "—";
    draw(page, dim, cols[2]!.x, y + 1, { font: regular, size: 9, maxWidth: cols[2]!.w });
    const price = o.available ? euro(o.totalTtc) : "—";
    draw(page, price, rightX - bold.widthOfTextAtSize(price, 10), y + 1, { font: bold, size: 10 });
    y -= rowH;
  }

  page.drawLine({ start: { x: M, y: y + 12 }, end: { x: rightX, y: y + 12 }, thickness: 1, color: INK });
  y -= 6;

  draw(
    page,
    `Prix TTC pour ${header.quantity} pneu${header.quantity > 1 ? "s" : ""} — ${MOUNT_LABEL} compris.`,
    M,
    y,
    { font: bold, size: 10 },
  );
  y -= 14;
  draw(
    page,
    "Prix indicatifs sous réserve de disponibilité au moment de la commande. Devis valable 15 jours.",
    M,
    y,
    { font: regular, size: 8, color: GREY },
  );
  y -= 11;
  draw(page, "Aucune autre prestation n'est incluse dans ces montants.", M, y, {
    font: regular,
    size: 8,
    color: GREY,
  });

  /* Pied de page. */
  page.drawLine({ start: { x: M, y: M + 18 }, end: { x: rightX, y: M + 18 }, thickness: 0.5, color: LINE });
  const foot = [header.site ? h.title : header.siteLabel || GROUP_LABEL, ...h.lines].join(" · ");
  draw(page, foot, M, M + 6, { font: regular, size: 7, color: GREY, maxWidth: rightX - M });

  const data = await pdf.save();
  return new Blob([data.slice() as unknown as ArrayBuffer], { type: "application/pdf" });
}

/** Ouvre le PDF dans un nouvel onglet, avec repli par téléchargement direct. */
export function openPdfBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
