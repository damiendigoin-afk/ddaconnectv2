/** Lecture d'un document d'achat déposé (commande, BL, facture) : compression image + OCR tolérant. */
import { isImage } from "@/lib/documents";
import { localDocText } from "@/lib/doc-text.browser";
import { blobToDataUrl, compressImage } from "@/lib/photo";
import { ocrPurchaseDocument } from "@/lib/ocr.functions";
import type { InvoiceExtract } from "@/lib/supplier-docs";
import { normalizePurchaseExtract } from "@/lib/purchase-extract";

export type ReadDoc = { file: File; extracted: InvoiceExtract; warning: string | null };

export async function readPurchaseDoc(file: File): Promise<ReadDoc> {
  const compressed = isImage(file) ? await compressImage(file) : null;
  const usable = compressed ? new File([compressed], file.name, { type: compressed.type || file.type }) : file;
  try {
    const dataUrl = await blobToDataUrl(usable);
    const res = await ocrPurchaseDocument({ data: { text: await localDocText(dataUrl), dataUrl, filename: usable.name } });
    if (res.ok) return { file: usable, extracted: normalizePurchaseExtract(JSON.parse(res.json)) as InvoiceExtract, warning: null };
    return { file: usable, extracted: {}, warning: `${res.error} Complétez à la main.` };
  } catch {
    return { file: usable, extracted: {}, warning: "Lecture automatique indisponible : complétez à la main." };
  }
}

/** Texte utile pour deviner le site destinataire d'un document. */
export function docSiteText(x: InvoiceExtract): string {
  return [x.customer_or_site, x.handwritten_notes].filter(Boolean).join(" ");
}
