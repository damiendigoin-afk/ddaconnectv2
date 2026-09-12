/**
 * Note de frais — document A4 unique (1 justificatif = 1 note = 1 page).
 * Aucun calcul : uniquement la mise en page des informations enregistrées et
 * du justificatif d'origine, affiché en grand.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

import ddaRenaultLogo from "@/assets/dda-renault-logo.jpeg.asset.json";
import { categoryLabel, euros, frDate, frDateTime, isPersonalPayment, paymentLabel, type ExpenseNote } from "@/lib/expenses";

const A4 = { w: 595.28, h: 841.89 };
const M = 36;
const BLACK = rgb(0.07, 0.07, 0.07);
const GREY = rgb(0.45, 0.45, 0.45);
const LIGHT = rgb(0.88, 0.88, 0.88);
const WHITE = rgb(1, 1, 1);
const YELLOW = rgb(1, 0.8, 0);
const RED = rgb(0.75, 0.15, 0.15);

function safe(t: string): string {
  return t
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[—–]/g, "-")
    .replace(/[^\x20-\xFF\n]/g, "");
}

async function bytesOf(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export type ExpensePdfInput = {
  note: ExpenseNote;
  siteLabel: string;
  receiptUrl: string | null;
};

export async function buildExpenseNotePdf(input: ExpensePdfInput): Promise<Uint8Array> {
  const { note } = input;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([A4.w, A4.h]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const text = (t: string, x: number, y: number, size: number, f: PDFFont = font, color = BLACK) =>
    page.drawText(safe(t), { x, y, size, font: f, color });

  /* -------------------------------- En-tête ------------------------------- */
  const headH = 86;
  page.drawRectangle({ x: 0, y: A4.h - headH, width: A4.w, height: headH, color: BLACK });
  page.drawRectangle({ x: 0, y: A4.h - headH - 4, width: A4.w, height: 4, color: YELLOW });

  const logo = await bytesOf(ddaRenaultLogo.url);
  let textX = M;
  if (logo) {
    try {
      const img = await pdf.embedJpg(logo);
      const w = 150;
      const h = (img.height / img.width) * w;
      page.drawImage(img, { x: M, y: A4.h - headH + (headH - h) / 2, width: w, height: h });
      textX = M + w + 18;
    } catch {
      /* le document reste valide sans logo */
    }
  }
  text("NOTE DE FRAIS", textX, A4.h - 38, 18, bold, WHITE);
  text(input.siteLabel, textX, A4.h - 56, 10, font, YELLOW);
  text(`Créée le ${frDateTime(note.created_at)} par ${note.user_name ?? "—"}`, textX, A4.h - 70, 9, font, rgb(0.8, 0.8, 0.8));

  /* ------------------------------- Bandeau -------------------------------- */
  const personal = isPersonalPayment(note.payment_method);
  const onAccount = isAccountPayment(note.payment_method);
  let y = A4.h - headH - 34;
  page.drawRectangle({
    x: M,
    y: y - 6,
    width: A4.w - 2 * M,
    height: 26,
    color: personal ? YELLOW : onAccount ? rgb(0.82, 0.9, 1) : rgb(0.9, 0.9, 0.9),
  });
  text(
    personal ? "À REMBOURSER" : onAccount ? "EN COMPTE - À RAPPROCHER" : "DÉJÀ RÉGLÉ - À COMPTABILISER",
    M + 10,
    y + 1,
    13,
    bold,
    BLACK,
  );

  /* ------------------------------- Détails -------------------------------- */
  y -= 30;
  const rows: [string, string][] = [
    ["Établissement", input.siteLabel],
    ["Date de la dépense", frDate(note.spent_on)],
    ["Fournisseur / enseigne", note.merchant || "—"],
    ["Motif", note.purpose || categoryLabel(note.category)],
    ["Moyen de règlement", paymentLabel(note.payment_method)],
  ];
  if (onAccount) rows.push(["Carte / compte utilisé", accountLabel(note.account_ref, note.account_other)]);
  rows.push(
    ["Montant TTC", euros(note.amount_ttc)],
    ["Dont TVA", note.vat_amount != null ? euros(note.vat_amount) : "—"],
    ["Auteur", note.user_name || "—"],
  );
  if (note.notes) rows.push(["Commentaire", note.notes]);
  if (note.validated_at) rows.push(["VALIDÉ", `${note.validated_by_name ?? "—"} le ${frDateTime(note.validated_at)}`]);
  if (note.settled_at) rows.push(["Remboursement réglé le", frDate(note.settled_at)]);
  if (note.reconciled_at) rows.push(["Rapprochée le", frDateTime(note.reconciled_at)]);
  if (note.accounted_at) rows.push(["Comptabilisée le", frDateTime(note.accounted_at)]);


  const boxTop = y;
  const lineH = 16;
  const boxH = rows.length * lineH + 12;
  page.drawRectangle({
    x: M,
    y: boxTop - boxH,
    width: A4.w - 2 * M,
    height: boxH,
    borderColor: LIGHT,
    borderWidth: 1,
    color: WHITE,
  });
  let ry = boxTop - 18;
  for (const [k, v] of rows) {
    const strong = k === "Montant TTC" || k === "VALIDÉ";
    text(k, M + 10, ry, 9, font, GREY);
    text(v, M + 165, ry, strong ? 11 : 9.5, strong ? bold : font, strong && k === "VALIDÉ" ? rgb(0.1, 0.5, 0.2) : BLACK);
    ry -= lineH;
  }
  y = boxTop - boxH - 18;

  /* ------------------------------ Justificatif ---------------------------- */
  text("JUSTIFICATIF", M, y, 9, bold, GREY);
  y -= 10;
  const areaH = y - 46;
  const areaW = A4.w - 2 * M;
  page.drawRectangle({ x: M, y: y - areaH, width: areaW, height: areaH, borderColor: LIGHT, borderWidth: 1 });

  const receipt = input.receiptUrl ? await bytesOf(input.receiptUrl) : null;
  let drawn = false;
  if (receipt) {
    const isPdf = receipt[0] === 0x25 && receipt[1] === 0x50; // %P
    try {
      if (isPdf) {
        const src = await PDFDocument.load(receipt);
        const [embedded] = await pdf.embedPdf(src, [0]);
        if (embedded) {
          const scale = Math.min((areaW - 16) / embedded.width, (areaH - 16) / embedded.height);
          page.drawPage(embedded, {
            x: M + (areaW - embedded.width * scale) / 2,
            y: y - areaH + (areaH - embedded.height * scale) / 2,
            xScale: scale,
            yScale: scale,
          });
          drawn = true;
        }
      } else {
        const img =
          receipt[0] === 0x89 ? await pdf.embedPng(receipt) : await pdf.embedJpg(receipt);
        const scale = Math.min((areaW - 16) / img.width, (areaH - 16) / img.height);
        page.drawImage(img, {
          x: M + (areaW - img.width * scale) / 2,
          y: y - areaH + (areaH - img.height * scale) / 2,
          width: img.width * scale,
          height: img.height * scale,
        });
        drawn = true;
      }
    } catch {
      drawn = false;
    }
  }
  if (!drawn) {
    text("Justificatif non disponible en image dans ce document.", M + 14, y - 24, 10, font, RED);
  }

  /* --------------------------------- Pied --------------------------------- */
  page.drawLine({ start: { x: M, y: 34 }, end: { x: A4.w - M, y: 34 }, thickness: 1, color: LIGHT });
  text(
    personal
      ? "Remboursement salarié à effectuer - document généré par DDA Connect"
      : "Dépense déjà réglée par l'entreprise - justificatif comptable - DDA Connect",
    M,
    22,
    8,
    font,
    GREY,
  );

  return pdf.save();
}

export function pdfToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
