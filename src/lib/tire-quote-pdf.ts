/**
 * Devis pneus — génération d'un VRAI document PDF A4 (pdf-lib, déjà présent
 * dans le projet). Aucun calcul ici : seules les offres déjà chiffrées par le
 * moteur pneus partagé sont mises en page. Aucun prix d'achat ni marge n'est
 * imprimé.
 *
 * Maquette : esprit Renault (noir franc, jaune Renault, blanc), en-tête sombre
 * pleine largeur avec le logo du projet, puis trois bandes de gamme
 * (entrée / milieu / haut) portant chacune deux cartes ÉTÉ et 4 SAISONS.
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
const M = 36;

const BLACK = rgb(0.07, 0.07, 0.07);
const INK = rgb(0.12, 0.12, 0.12);
const GREY = rgb(0.45, 0.45, 0.45);
const LIGHT = rgb(0.86, 0.86, 0.86);
const PAPER = rgb(1, 1, 1);
const YELLOW = rgb(1, 0.8, 0);
const SUN = rgb(0.95, 0.6, 0.05);
const ICE = rgb(0.13, 0.42, 0.72);

type Rgb = ReturnType<typeof rgb>;

function euro(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${Number(v).toFixed(2).replace(".", ",")} €`;
}

/** Helvetica ne connaît que WinAnsi : on remplace les caractères hors jeu. */
function safe(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[—–]/g, "-")
    .replace(/[•·]/g, "-");
}

function clip(font: PDFFont, text: string, size: number, max: number): string {
  let out = safe(text);
  if (font.widthOfTextAtSize(out, size) <= max) return out;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > max) out = out.slice(0, -1);
  return `${out}...`;
}

function draw(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  opts: { font: PDFFont; size: number; color?: Rgb; maxWidth?: number },
) {
  const t = opts.maxWidth ? clip(opts.font, text, opts.size, opts.maxWidth) : safe(text);
  page.drawText(t, { x, y, size: opts.size, font: opts.font, color: opts.color ?? INK });
}

function drawRight(
  page: PDFPage,
  text: string,
  right: number,
  y: number,
  opts: { font: PDFFont; size: number; color?: Rgb; maxWidth?: number },
) {
  const t = opts.maxWidth ? clip(opts.font, text, opts.size, opts.maxWidth) : safe(text);
  page.drawText(t, {
    x: right - opts.font.widthOfTextAtSize(t, opts.size),
    y,
    size: opts.size,
    font: opts.font,
    color: opts.color ?? INK,
  });
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

/** Petit soleil dessiné vectoriellement (aucun asset externe). */
function drawSun(page: PDFPage, cx: number, cy: number, r: number, color: Rgb) {
  page.drawCircle({ x: cx, y: cy, size: r, color });
  for (let i = 0; i < 8; i += 1) {
    const a = (Math.PI / 4) * i;
    page.drawLine({
      start: { x: cx + Math.cos(a) * (r + 1.4), y: cy + Math.sin(a) * (r + 1.4) },
      end: { x: cx + Math.cos(a) * (r + 3.4), y: cy + Math.sin(a) * (r + 3.4) },
      thickness: 1,
      color,
    });
  }
}

/** Petit flocon dessiné vectoriellement (aucun asset externe). */
function drawSnowflake(page: PDFPage, cx: number, cy: number, r: number, color: Rgb) {
  for (let i = 0; i < 3; i += 1) {
    const a = (Math.PI / 3) * i;
    const dx = Math.cos(a) * r;
    const dy = Math.sin(a) * r;
    page.drawLine({
      start: { x: cx - dx, y: cy - dy },
      end: { x: cx + dx, y: cy + dy },
      thickness: 1.1,
      color,
    });
    for (const s of [-1, 1]) {
      const tipX = cx + dx * s;
      const tipY = cy + dy * s;
      const b1 = a + Math.PI * 0.75 * s;
      const b2 = a - Math.PI * 0.75 * s;
      page.drawLine({
        start: { x: tipX, y: tipY },
        end: { x: tipX + Math.cos(b1) * r * 0.4, y: tipY + Math.sin(b1) * r * 0.4 },
        thickness: 0.9,
        color,
      });
      page.drawLine({
        start: { x: tipX, y: tipY },
        end: { x: tipX + Math.cos(b2) * r * 0.4, y: tipY + Math.sin(b2) * r * 0.4 },
        thickness: 0.9,
        color,
      });
    }
  }
}

const TIERS: { key: string; label: string; band: Rgb }[] = [
  { key: "entree", label: "ENTRÉE DE GAMME", band: rgb(0.42, 0.42, 0.42) },
  { key: "milieu", label: "MILIEU DE GAMME", band: rgb(0.26, 0.26, 0.26) },
  { key: "haut", label: "HAUT DE GAMME", band: BLACK },
];

function offerFor(offers: SevenOffer[], tier: string, season: string): SevenOffer | null {
  return (
    offers.find((o) => o.slot === `${tier}_${season}`) ??
    offers.find((o) => o.tier === tier && o.season === season) ??
    null
  );
}

/** Document client A4, conçu pour tenir sur une seule page avec 6 ou 7 offres. */
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
  const garage = header.site ? h.title : header.siteLabel || GROUP_LABEL;
  const date = new Date(header.createdAt).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const rightX = A4.w - M;
  const innerW = rightX - M;

  /* ------------------------------ En-tête ------------------------------- */
  const headH = 118;
  page.drawRectangle({ x: 0, y: A4.h - headH, width: A4.w, height: headH, color: BLACK });
  page.drawRectangle({ x: 0, y: A4.h - headH - 5, width: A4.w, height: 5, color: YELLOW });

  let textX = M;
  const bytes = await logoBytes();
  if (bytes) {
    try {
      const img = await pdf.embedJpg(bytes);
      // Le logo est déjà sur fond noir : il se pose directement sur l'en-tête.
      const logoW = 190;
      const logoH = (img.height / img.width) * logoW;
      page.drawImage(img, { x: M, y: A4.h - headH + 44, width: logoW, height: logoH });
      textX = M;
    } catch {
      /* Logo indisponible : le document reste valide sans image. */
    }
  }


  let gy = A4.h - headH + 26;
  draw(page, garage, textX, gy, { font: bold, size: 10.5, color: PAPER, maxWidth: 320 });
  gy -= 10;
  for (const line of h.lines.slice(0, 2)) {
    draw(page, line, textX, gy, { font: regular, size: 7.5, color: rgb(0.75, 0.75, 0.75), maxWidth: 320 });
    gy -= 9;
  }

  drawRight(page, "DEVIS", rightX, A4.h - 46, { font: bold, size: 22, color: PAPER });
  drawRight(page, "PNEUMATIQUES", rightX, A4.h - 68, { font: bold, size: 15, color: YELLOW });
  drawRight(page, date, rightX, A4.h - 86, { font: regular, size: 9, color: PAPER });
  if (header.userName) {
    drawRight(page, header.userName, rightX, A4.h - 98, {
      font: regular,
      size: 8,
      color: rgb(0.75, 0.75, 0.75),
      maxWidth: 200,
    });
  }

  /* -------------------------- Bloc informations -------------------------- */
  const dimension = `${header.size}${
    header.loadIndex || header.speedIndex
      ? ` ${header.loadIndex ?? ""}${header.speedIndex ?? ""}`
      : ""
  }`;
  const info: [string, string][] = [
    ["DIMENSION", dimension],
    ["QUANTITÉ", `${header.quantity} pneu${header.quantity > 1 ? "s" : ""}`],
    ["CLIENT", header.customerName || "—"],
    ["VÉHICULE", [header.vehicleLabel, header.plate].filter(Boolean).join(" - ") || "—"],
  ];
  if (header.requestedBrand) info.push(["MARQUE DEMANDÉE", header.requestedBrand]);

  const rows = Math.ceil(info.length / 2);
  const infoH = rows * 22 + 10;
  let y = A4.h - headH - 5 - 14 - infoH;
  page.drawRectangle({
    x: M,
    y,
    width: innerW,
    height: infoH,
    color: rgb(0.965, 0.965, 0.965),
    borderColor: LIGHT,
    borderWidth: 0.6,
  });
  const colW = innerW / 2;
  info.forEach((pair, i) => {
    const x = M + (i % 2) * colW + 12;
    const ry = y + infoH - 16 - Math.floor(i / 2) * 22;
    draw(page, pair[0], x, ry, { font: bold, size: 6.5, color: GREY });
    draw(page, pair[1], x, ry - 10, { font: bold, size: 10.5, maxWidth: colW - 24 });
  });

  y -= 20;

  /* ------------------------- Cartes par gamme ---------------------------- */
  const cardW = (innerW - 12) / 2;
  const cardH = 72;
  const bandH = 15;

  const seasons: { key: string; label: string; color: Rgb; icon: "sun" | "snow" }[] = [
    { key: "ete", label: "ÉTÉ", color: SUN, icon: "sun" },
    { key: "quatre_saisons", label: "4 SAISONS", color: ICE, icon: "snow" },
  ];

  for (const tier of TIERS) {
    /* Bande de gamme. */
    page.drawRectangle({ x: M, y: y - bandH, width: innerW, height: bandH, color: tier.band });
    page.drawRectangle({ x: M, y: y - bandH, width: 4, height: bandH, color: YELLOW });
    draw(page, tier.label, M + 12, y - bandH + 4.5, { font: bold, size: 8, color: PAPER });
    y -= bandH + 6;

    seasons.forEach((s, i) => {
      const x = M + i * (cardW + 12);
      const top = y;
      const bottom = y - cardH;
      page.drawRectangle({
        x,
        y: bottom,
        width: cardW,
        height: cardH,
        color: PAPER,
        borderColor: LIGHT,
        borderWidth: 0.8,
      });
      page.drawRectangle({ x, y: bottom, width: 3, height: cardH, color: s.color });

      if (s.icon === "sun") drawSun(page, x + 20, top - 15, 4, s.color);
      else drawSnowflake(page, x + 20, top - 15, 5, s.color);
      draw(page, s.label, x + 30, top - 18, { font: bold, size: 8.5, color: s.color });

      const o = offerFor(offers, tier.key, s.key);
      const available = Boolean(o?.available);
      const brandLine = available
        ? [o?.brand, o?.model].filter(Boolean).join(" ") || "—"
        : o?.brand || "—";
      draw(page, brandLine, x + 12, top - 36, {
        font: bold,
        size: 11,
        color: available ? INK : GREY,
        maxWidth: cardW - 24,
      });

      const dim = available
        ? [o?.size, [o?.loadIndex, o?.speedIndex].filter(Boolean).join("")].filter(Boolean).join(" ")
        : o?.unavailableReason || "Non disponible";
      draw(page, dim, x + 12, top - 48, {
        font: regular,
        size: 8,
        color: GREY,
        maxWidth: cardW - 24,
      });

      if (available) {
        drawRight(page, euro(o?.totalTtc), x + cardW - 12, bottom + 10, {
          font: bold,
          size: 15,
        });
        draw(
          page,
          `${header.quantity} pneu${header.quantity > 1 ? "s" : ""} - montage inclus`,
          x + 12,
          bottom + 10,
          { font: regular, size: 7.5, color: GREY, maxWidth: cardW - 90 },
        );
      } else {
        drawRight(page, "Indisponible", x + cardW - 12, bottom + 12, {
          font: bold,
          size: 10,
          color: GREY,
        });
      }
    });

    y -= cardH + 10;
  }

  /* --------------------- 7e offre : marque demandée ---------------------- */
  const extra = offers.find((o) => o.kind === "identique");
  if (extra) {
    const barH = 34;
    page.drawRectangle({
      x: M,
      y: y - barH,
      width: innerW,
      height: barH,
      color: rgb(1, 0.97, 0.85),
      borderColor: YELLOW,
      borderWidth: 1,
    });
    draw(page, safe(extra.title || "MARQUE DEMANDÉE").toUpperCase(), M + 12, y - 13, {
      font: bold,
      size: 7,
      color: rgb(0.5, 0.4, 0),
      maxWidth: innerW - 140,
    });
    const label = extra.available
      ? [
          [extra.brand, extra.model].filter(Boolean).join(" "),
          [extra.size, [extra.loadIndex, extra.speedIndex].filter(Boolean).join("")]
            .filter(Boolean)
            .join(" "),
        ]
          .filter(Boolean)
          .join(" - ")
      : extra.unavailableReason || "Non disponible";
    draw(page, label, M + 12, y - 26, {
      font: bold,
      size: 10,
      color: extra.available ? INK : GREY,
      maxWidth: innerW - 140,
    });
    if (extra.available) {
      drawRight(page, euro(extra.totalTtc), rightX - 12, y - 24, { font: bold, size: 14 });
    } else {
      drawRight(page, "Indisponible", rightX - 12, y - 22, { font: bold, size: 10, color: GREY });
    }
    y -= barH + 10;
  }

  /* ------------------------------- Mentions ------------------------------ */
  page.drawLine({ start: { x: M, y: y - 2 }, end: { x: rightX, y: y - 2 }, thickness: 1, color: BLACK });
  y -= 16;
  draw(page, `${MOUNT_LABEL} compris.`, M, y, { font: bold, size: 9.5 });
  y -= 12;
  draw(
    page,
    "Prix TTC indicatifs sous réserve de disponibilité au moment de la commande. Devis valable 15 jours.",
    M,
    y,
    { font: regular, size: 7.5, color: GREY, maxWidth: innerW },
  );
  y -= 10;
  draw(page, "Aucune autre prestation n'est incluse dans ces montants.", M, y, {
    font: regular,
    size: 7.5,
    color: GREY,
    maxWidth: innerW,
  });

  /* ------------------------------- Pied ---------------------------------- */
  page.drawRectangle({ x: 0, y: 0, width: A4.w, height: 26, color: BLACK });
  page.drawRectangle({ x: 0, y: 26, width: A4.w, height: 3, color: YELLOW });
  const foot = [garage, ...h.lines].join(" - ");
  draw(page, foot, M, 10, { font: regular, size: 7, color: rgb(0.8, 0.8, 0.8), maxWidth: innerW });

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
