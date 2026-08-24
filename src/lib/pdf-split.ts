/** Découpage d'un PDF en extraits de pages, côté navigateur (pdf-lib). */
import { PDFDocument } from "pdf-lib";

function toDataUrl(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:application/pdf;base64,${btoa(bin)}`;
}

export async function loadPdf(file: File) {
  const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  return { doc, pageCount: doc.getPageCount() };
}

/** Extrait les pages [from..to] (1-indexées) en un PDF autonome encodé en data URL. */
export async function extractPagesDataUrl(
  doc: PDFDocument,
  from: number,
  to: number,
): Promise<string> {
  const out = await PDFDocument.create();
  const indices = [];
  for (let p = from; p <= to; p += 1) indices.push(p - 1);
  const pages = await out.copyPages(doc, indices);
  pages.forEach((p) => out.addPage(p));
  return toDataUrl(await out.save());
}
