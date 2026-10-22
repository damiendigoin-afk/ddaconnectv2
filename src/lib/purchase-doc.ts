/**
 * Lecture d'un document d'achat déposé (commande, BL, facture).
 *  - Photo : compression -> vision IA serveur directe (aucun OCR local avant).
 *    OCR local Tesseract uniquement en secours si la vision est indisponible / inexploitable,
 *    puis « Lecture à vérifier » obligatoire.
 *  - PDF : texte natif (ou OCR scan) d'abord, comme avant.
 */
import { isImage } from "@/lib/documents";
import { localDocText } from "@/lib/doc-text.browser";
import { blobToDataUrl, compressImage } from "@/lib/photo";
import { ocrPurchaseDocument } from "@/lib/ocr.functions";
import type { InvoiceExtract } from "@/lib/supplier-docs";
import { normalizePurchaseExtract } from "@/lib/purchase-extract";
import { hasUsableOrderLines, logOrderLineContract, orderFormLinesFromDoc, orderLineContractDiagnostic } from "@/lib/receipt-lines";

/** Étapes visibles de la lecture (aucun pourcentage fictif). */
export type ReadStage = "prepare" | "vision" | "fallback_ocr" | "checking" | "matching";
export const READ_STAGE_LABEL: Record<ReadStage, string> = {
  prepare: "Préparation de la photo…",
  vision: "Lecture IA…",
  fallback_ocr: "Lecture complémentaire du document…",
  checking: "Contrôle des informations…",
  matching: "Recherche de la commande…",
};

/** Mesures internes non sensibles (durées seulement, jamais de contenu). */
export type ReadTimings = { image_prepare_ms: number; vision_ms: number; fallback_ocr_ms: number; validation_ms: number; total_read_ms: number };

/** `file` = ORIGINAL déposé (seul conservé) ; l'image compressée ne sert qu'à la lecture. */
export type ReadDoc = { file: File; extracted: InvoiceExtract; warning: string | null; timings?: ReadTimings; fallbackOcr?: boolean };

type OcrRes = { ok: boolean; error: string; json: string };

/** Vision photo inexploitable : erreur serveur, JSON vide, ou vision marquée en échec. */
export function visionUnusable(res: OcrRes | null): boolean {
  if (!res || !res.json) return true;
  try {
    const raw = JSON.parse(res.json) as { read_provenance?: { vision_initial?: string } } | null;
    if (!raw || typeof raw !== "object" || !Object.keys(raw).length) return true;
    return raw.read_provenance?.vision_initial === "failed";
  } catch {
    return true;
  }
}

export async function readPurchaseDoc(file: File, onStage?: (s: ReadStage) => void): Promise<ReadDoc> {
  const t0 = Date.now();
  const tm: ReadTimings = { image_prepare_ms: 0, vision_ms: 0, fallback_ocr_ms: 0, validation_ms: 0, total_read_ms: 0 };
  const photo = isImage(file);
  let fallbackUsed = false;
  try {
    onStage?.("prepare");
    const compressed = photo ? await compressImage(file) : null;
    const usable = compressed ? new File([compressed], file.name, { type: compressed.type || file.type }) : file;
    const dataUrl = await blobToDataUrl(usable);
    let res: OcrRes | null;
    if (photo) {
      tm.image_prepare_ms = Date.now() - t0;
      onStage?.("vision");
      const tv = Date.now();
      res = await ocrPurchaseDocument({ data: { dataUrl, filename: usable.name } }).catch(() => null);
      tm.vision_ms = Date.now() - tv;
      if (visionUnusable(res)) {
        // Secours unique : OCR local sur le blob compressé (pas de nouvelle vision, image non renvoyée).
        onStage?.("fallback_ocr");
        const tf = Date.now();
        const text = await localDocText(usable, usable.name);
        tm.fallback_ocr_ms = Date.now() - tf;
        fallbackUsed = true;
        if (text.trim()) res = await ocrPurchaseDocument({ data: { text, filename: usable.name, fallbackOcr: true } }).catch(() => res);
      }
    } else {
      const text = await localDocText(usable, usable.name);
      tm.image_prepare_ms = Date.now() - t0;
      onStage?.("vision");
      const tv = Date.now();
      res = await ocrPurchaseDocument({ data: { text, dataUrl, filename: usable.name } });
      tm.vision_ms = Date.now() - tv;
    }
    onStage?.("checking");
    const tc = Date.now();
    const done = (r: ReadDoc): ReadDoc => {
      tm.validation_ms = Date.now() - tc;
      tm.total_read_ms = Date.now() - t0;
      console.info("[purchase-read] timings", { ...tm, photo, fallback_ocr: fallbackUsed });
      return { ...r, timings: { ...tm }, fallbackOcr: fallbackUsed };
    };
    if (!res) return done({ file, extracted: {}, warning: "Lecture automatique indisponible : complétez à la main." });
    const raw = res.json ? JSON.parse(res.json) as unknown : {};
    logOrderLineContract("response", raw, []);
    const extracted = normalizePurchaseExtract(raw) as InvoiceExtract;
    const mapped = orderFormLinesFromDoc(extracted);
    logOrderLineContract("normalized", extracted, mapped);
    const diagnostic = orderLineContractDiagnostic(raw, mapped);
    if (diagnostic.parsedCount > 0 && (diagnostic.mappedCount === 0 || diagnostic.blankMappedCount === diagnostic.mappedCount)) {
      console.warn("[purchase-import] line contract rejected", diagnostic);
      return done({ file, extracted, warning: "Les lignes détectées n'ont pas pu être transmises au formulaire. Le document doit être relu ou complété manuellement." });
    }
    if (!hasUsableOrderLines(mapped)) {
      console.warn("[purchase-import] zero lines extracted", diagnostic);
      return done({ file, extracted, warning: "Aucune ligne détectée dans le document – vérifiez le document ou ajoutez les lignes manuellement." });
    }
    if (res.ok) return done({ file, extracted, warning: null });
    return done({ file, extracted, warning: `${res.error} Complétez ou contrôlez les informations signalées.` });
  } catch {
    return { file, extracted: {}, warning: "Lecture automatique indisponible : complétez à la main." };
  }
}

/** Texte utile pour deviner le site destinataire d'un document. */
export function docSiteText(x: InvoiceExtract): string {
  return [x.customer_or_site, x.handwritten_notes].filter(Boolean).join(" ");
}
