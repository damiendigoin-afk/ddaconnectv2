/**
 * Première passe SANS IA (0 crédit) de toute lecture photo/PDF DDA Connect :
 *  - PDF texte : couche texte native (pdfjs) ;
 *  - PDF scanné / image : OCR classique local (Tesseract.js, français).
 * Jamais bloquant : en cas d'échec renvoie "" et le serveur décide de la suite.
 */
import { extractPdfText } from "./pdf-text";

type TWorker = {
  recognize: (img: HTMLCanvasElement) => Promise<{ data: { text: string } }>;
  setParameters: (p: Record<string, string>) => Promise<unknown>;
};
let workerPromise: Promise<TWorker> | null = null;

function getWorker(): Promise<TWorker> {
  // SSR guard: keeps tesseract.js (CommonJS, needs createRequire) out of the server bundle.
  if (import.meta.env.SSR) return Promise.reject(new Error("OCR indisponible côté serveur"));
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

async function ocrCanvas(c: HTMLCanvasElement, psm = "3"): Promise<string> {
  const w = await getWorker();
  await w.setParameters({ tessedit_pageseg_mode: psm });
  return (await w.recognize(c)).data.text ?? "";
}

/**
 * Binarisation adaptative (moyenne locale, image intégrale) : supprime l'ombre et le
 * dégradé de lumière des photos de téléphone, qui font perdre à Tesseract les petits
 * champs d'un formulaire (immatriculation, VIN, client) — cause constatée sur OR papier.
 */
export function adaptiveBinarize(gray: Uint8ClampedArray | number[], w: number, h: number, radius = 20, offset = 10): Uint8ClampedArray {
  const ii = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y += 1) {
    let row = 0;
    for (let x = 0; x < w; x += 1) {
      row += gray[y * w + x]!;
      ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1]! + row;
    }
  }
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.max(0, y - radius), y1 = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(w, x + radius + 1);
      const sum = ii[y1 * (w + 1) + x1]! - ii[y0 * (w + 1) + x1]! - ii[y1 * (w + 1) + x0]! + ii[y0 * (w + 1) + x0]!;
      const mean = sum / ((y1 - y0) * (x1 - x0));
      out[y * w + x] = gray[y * w + x]! < mean - offset ? 0 : 255;
    }
  }
  return out;
}

function binarizedCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const gray = new Uint8ClampedArray(c.width * c.height);
  for (let i = 0; i < gray.length; i += 1) gray[i] = img.data[i * 4]!;
  const bin = adaptiveBinarize(gray, c.width, c.height, Math.round(Math.max(c.width, c.height) / 110));
  for (let i = 0; i < bin.length; i += 1) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = bin[i]!;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
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
export async function localDocText(
  src: Blob | string,
  name = "document",
  /** Photo : relance une 2e passe OCR (binarisée, texte épars) si la 1re lecture est insuffisante. */
  retry?: (text: string) => boolean,
): Promise<string> {
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
    const canvas = await imageCanvas(bmp);
    const first = await ocrCanvas(canvas);
    if (!retry || !retry(first)) return first.slice(0, 40000);
    // 2e passe gratuite : binarisation adaptative + segmentation « texte épars » (formulaires).
    const second = await ocrCanvas(binarizedCanvas(canvas), "11");
    return `${first}\n${second}`.slice(0, 40000);
  } catch (e) {
    console.warn("OCR local indisponible", e);
    return "";
  }
}
