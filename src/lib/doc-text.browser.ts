/**
 * Première passe SANS IA (0 crédit) de toute lecture photo/PDF DDA Connect :
 *  - PDF texte : couche texte native (pdfjs) ;
 *  - PDF scanné / image : OCR classique local (Tesseract.js, français).
 * Jamais bloquant : en cas d'échec renvoie "" et le serveur décide de la suite.
 */
import { extractPdfText } from "./pdf-text";

type TWorker = { recognize: (img: HTMLCanvasElement) => Promise<{ data: { text: string } }> };
let workerPromise: Promise<TWorker> | null = null;

function getWorker(): Promise<TWorker> {
  if (!workerPromise) {
    workerPromise = import("tesseract.js")
      .then(async (m) => (await m.createWorker("fra")) as unknown as TWorker)
      .catch((e) => {
        workerPromise = null;
        throw e;
      });
  }
  return workerPromise;
}

async function imageCanvas(src: CanvasImageSource & { width: number; height: number }): Promise<HTMLCanvasElement> {
  const scale = Math.min(2, 2200 / Math.max(src.width, src.height));
  const c = document.createElement("canvas");
  c.width = Math.round(src.width * scale);
  c.height = Math.round(src.height * scale);
  const ctx = c.getContext("2d")!;
  ctx.filter = "grayscale(1) contrast(1.4)";
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

async function ocrCanvas(c: HTMLCanvasElement): Promise<string> {
  const w = await getWorker();
  return (await w.recognize(c)).data.text ?? "";
}

async function pdfText(file: File): Promise<string> {
  const { pages } = await extractPdfText(file);
  const out: string[] = [];
  for (const p of pages) {
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const f of p.fragments) {
      const y = Math.round(f.y / 3) * 3;
      rows.set(y, [...(rows.get(y) ?? []), { x: f.x, s: f.str }]);
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      out.push(rows.get(y)!.sort((a, b) => a.x - b.x).map((r) => r.s).join(" "));
    }
  }
  return out.join("\n");
}

async function scannedPdfText(file: File, maxPages = 2): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i += 1) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 2 });
    const c = document.createElement("canvas");
    c.width = vp.width;
    c.height = vp.height;
    await page.render({ canvasContext: c.getContext("2d")!, viewport: vp, canvas: c } as never).promise;
    out.push(await ocrCanvas(c));
  }
  return out.join("\n");
}

/** Texte local d'un document (File, Blob ou dataUrl). */
export async function localDocText(src: Blob | string, name = "document"): Promise<string> {
  try {
    const blob = typeof src === "string" ? await (await fetch(src)).blob() : src;
    const isPdf = blob.type === "application/pdf" || name.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      const file = blob instanceof File ? blob : new File([blob], name, { type: "application/pdf" });
      const native = await pdfText(file);
      if (native.replace(/\s/g, "").length >= 40) return native.slice(0, 40000);
      return (await scannedPdfText(file)).slice(0, 40000);
    }
    if (!blob.type.startsWith("image/")) return "";
    const bmp = await createImageBitmap(blob);
    return (await ocrCanvas(await imageCanvas(bmp))).slice(0, 40000);
  } catch (e) {
    console.warn("OCR local indisponible", e);
    return "";
  }
}
