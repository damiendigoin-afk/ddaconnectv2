/** Lecture d'un document d'achat déposé (commande, BL, facture) : compression image + OCR tolérant. */
import { isImage } from "@/lib/documents";
import { localDocText } from "@/lib/doc-text.browser";
import { blobToDataUrl, compressImage } from "@/lib/photo";
import { ocrPurchaseDocument } from "@/lib/ocr.functions";
import type { InvoiceExtract } from "@/lib/supplier-docs";
import { normalizePurchaseExtract } from "@/lib/purchase-extract";
import { logOrderLineContract, orderFormLinesFromDoc, orderLineContractDiagnostic } from "@/lib/receipt-lines";

/** `file` = ORIGINAL déposé (seul conservé) ; l'image compressée ne sert qu'à la lecture. */
export type ReadDoc = { file: File; extracted: InvoiceExtract; warning: string | null };

export async function readPurchaseDoc(file: File): Promise<ReadDoc> {
  const compressed = isImage(file) ? await compressImage(file) : null;
  const usable = compressed ? new File([compressed], file.name, { type: compressed.type || file.type }) : file;
  try {
    const dataUrl = await blobToDataUrl(usable);
    const res = await ocrPurchaseDocument({ data: { text: await localDocText(dataUrl), dataUrl, filename: usable.name } });
    const raw = res.json ? JSON.parse(res.json) as unknown : {};
    logOrderLineContract("response", raw, []);
    const extracted = normalizePurchaseExtract(raw) as InvoiceExtract;
    const mapped = orderFormLinesFromDoc(extracted);
    logOrderLineContract("normalized", extracted, mapped);
    const diagnostic = orderLineContractDiagnostic(raw, mapped);
    if (diagnostic.parsedCount > 0 && (diagnostic.mappedCount === 0 || diagnostic.blankMappedCount === diagnostic.mappedCount)) {
      console.warn("[purchase-import] line contract rejected", diagnostic);
      return { file, extracted, warning: "Les lignes détectées n'ont pas pu être transmises au formulaire. Le document doit être relu ou complété manuellement." };
    }
    if (res.ok) return { file, extracted, warning: null };
    const partial = extracted;
    return { file, extracted: partial, warning: `${res.error} Complétez ou contrôlez les informations signalées.` };
  } catch {
    return { file, extracted: {}, warning: "Lecture automatique indisponible : complétez à la main." };
  }
}

/** Texte utile pour deviner le site destinataire d'un document. */
export function docSiteText(x: InvoiceExtract): string {
  return [x.customer_or_site, x.handwritten_notes].filter(Boolean).join(" ");
}
