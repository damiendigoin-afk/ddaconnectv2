/**
 * Analyses visuelles Gemini — toutes routées par le service central `runPaidAi`
 * (cache par empreinte, budget, journal, aucun retry payant).
 */
import { MANUAL_FALLBACK_MESSAGE, runPaidAi, type PaidAiResult } from "./ai-usage.server";

export const VISION_MODEL = "google/gemini-3.8-flash";

type Block =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

function blockFor(dataUrl: string, filename?: string): Block {
  return dataUrl.startsWith("data:application/pdf")
    ? { type: "file", file: { filename: filename || "document.pdf", file_data: dataUrl } }
    : { type: "image_url", image_url: { url: dataUrl } };
}

export async function askVision(
  prompt: string,
  dataUrl: string,
  filename?: string,
  feature = "vision",
  extra: Record<string, unknown> = {},
  essentialVision = false,
  /** Banc de test uniquement : nouvelle analyse sans cache + rapport des métriques. */
  opts: { bypassCache?: boolean; onResult?: (r: PaidAiResult) => void } = {},
) {
  const res = await runPaidAi({
    feature,
    essentialVision,
    route: "ai_vision_fallback",
    fingerprintSeed: `${prompt}\u0000${dataUrl}`,
    model: VISION_MODEL,
    body: { ...extra, messages: [{ role: "user", content: [{ type: "text", text: prompt }, blockFor(dataUrl, filename)] }] },
    ...(opts.bypassCache ? { bypassCache: true } : {}),
  });
  opts.onResult?.(res);
  if (!res.ok) return { ok: false as const, error: res.error };
  return { ok: true as const, content: res.content };
}

export async function askVisionMulti(
  prompt: string,
  images: { dataUrl: string; filename?: string }[],
  feature = "vision_multi",
) {
  if (!images.length) return { ok: false as const, error: MANUAL_FALLBACK_MESSAGE };
  const blocks: Block[] = [{ type: "text", text: prompt }, ...images.map((i) => blockFor(i.dataUrl, i.filename))];
  const res = await runPaidAi({
    feature,
    fingerprintSeed: `${prompt}\u0000${images.map((i) => i.dataUrl).join("\u0000")}`,
    model: VISION_MODEL,
    body: { messages: [{ role: "user", content: blocks }] },
  });
  if (!res.ok) return { ok: false as const, error: res.error };
  return { ok: true as const, content: res.content };
}

export function parseJsonBlock(content: string): Record<string, unknown> | null {
  const cleaned = content
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
