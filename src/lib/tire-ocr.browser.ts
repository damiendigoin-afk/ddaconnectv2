/**
 * OCR local (navigateur) des photos de flanc — Tesseract.js, aucune API IA.
 * Prétraitement léger : réduction, niveaux de gris, étirement de contraste,
 * lecture droite puis retournée à 180° si la première ne donne rien.
 */
import { parseTireText, type TireOcrRead } from "./tire-ocr-parse";

type Worker = { recognize: (img: HTMLCanvasElement) => Promise<{ data: { text: string } }> };
let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  // SSR guard: keeps tesseract.js (CommonJS, needs createRequire) out of the server bundle.
  if (import.meta.env.SSR) throw new Error("OCR indisponible côté serveur");
  if (!workerPromise) {
    workerPromise = import("tesseract.js").then(async (m) => {
      const w = await m.createWorker("eng");
      await w.setParameters({ tessedit_pageseg_mode: "11" as never });
      return w as unknown as Worker;
    });
  }
  return workerPromise;
}

async function toCanvas(blob: Blob, rotate180 = false): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  if (rotate180) {
    ctx.translate(w, h);
    ctx.rotate(Math.PI);
  }
  ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
    d[i] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const span = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    const v = ((d[i]! - min) * 255) / span;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Lit une photo ; renvoie la meilleure lecture (droite ou 180°). */
export async function ocrTirePhoto(blob: Blob, brands: string[] = []): Promise<TireOcrRead> {
  const worker = await getWorker();
  const first = parseTireText((await worker.recognize(await toCanvas(blob))).data.text, brands);
  if (first.size || first.brand) return first;
  const flipped = parseTireText((await worker.recognize(await toCanvas(blob, true))).data.text, brands);
  const score = (r: TireOcrRead) => (r.size ? 4 : 0) + (r.load ? 1 : 0) + (r.brand ? 1 : 0) + (r.season ? 1 : 0);
  return score(flipped) > score(first) ? { ...flipped, raw: `${first.raw}\n--- 180° ---\n${flipped.raw}` } : first;
}
