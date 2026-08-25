/**
 * Extraction de la couche texte d'un PDF, côté navigateur (pdfjs-dist).
 * Coût : 0 crédit. Aucun envoi de document à une IA.
 */
import type { PageText } from "./packages-parse";

type PdfJs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJs> | null = null;

async function getPdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

/** Empreinte SHA-256 d'un fichier (anti-doublon et reprise de job). */
export async function fileFingerprint(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type ExtractProgress = (done: number, total: number) => void;

/** Extrait le texte page par page avec coordonnées X/Y. */
export async function extractPdfText(
  file: File,
  onProgress?: ExtractProgress,
  skipPages?: Set<number>,
): Promise<{ pages: PageText[]; pageCount: number }> {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: PageText[] = [];

  for (let p = 1; p <= doc.numPages; p += 1) {
    if (skipPages?.has(p)) {
      onProgress?.(p, doc.numPages);
      continue;
    }
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items as unknown as { str?: string; transform?: number[] }[];
    const fragments = items
      .filter((i): i is { str: string; transform: number[] } => typeof i.str === "string")
      .map((i) => ({
        str: i.str,
        x: Math.round(i.transform?.[4] ?? 0),
        y: Math.round(i.transform?.[5] ?? 0),
      }));

    pages.push({ page: p, fragments });
    page.cleanup();
    onProgress?.(p, doc.numPages);
  }

  return { pages, pageCount: doc.numPages };
}
