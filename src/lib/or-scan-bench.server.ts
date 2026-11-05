/** Banc comparatif OR (isolé) : vision d'abord sur une photo conservée vs lecture production enregistrée. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

import { BENCH_FEATURE, type PaidAiResult } from "./ai-usage.server";
import { readDocument } from "./doc-pipeline.server";
import { OR_SCAN_MODEL } from "./or-scan-model";
import { OR_SCAN_PROMPT } from "./or-scan-prompt";
import { scoreRead, summarizeScores } from "./or-scan-validate";
import { sanitizeRepairOrder } from "./doc-rules";

type Row = { photo_path: string; read_fields: unknown; confirmed_fields: unknown; rules_fields: unknown; ai_calls: number | null; route: string | null };

export async function runOrBenchVision(row: Row) {
  const { data: blob, error } = await supabaseAdmin.storage.from("or-scans").download(row.photo_path);
  if (error || !blob) throw new Error("Photo indisponible.");
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const dataUrl = `data:${blob.type || "image/jpeg"};base64,${btoa(bin)}`;
  let credits = 0, ms = 0;
  const started = Date.now();
  const r = await readDocument({
    feature: `${BENCH_FEATURE}_or`, kind: "repair_order", prompt: OR_SCAN_PROMPT, text: "", dataUrl, model: OR_SCAN_MODEL,
    forceVisionFirst: true,
    bench: { bypassCache: true, onAi: (_route, res: PaidAiResult) => { if (res.ok) credits += res.credits; } },
  });
  ms = Date.now() - started;
  const vision = sanitizeRepairOrder(r.fields).fields;
  delete (vision as Record<string, unknown>)["_suspect"];
  const ref = row.confirmed_fields ?? null;
  const prod = row.read_fields ?? null;
  return {
    at: new Date().toISOString(),
    reference: ref ? "confirmed" : "none",
    vision: { fields: vision, ai_calls: r.aiCalls, credits, ms, route: r.route, ...(ref ? { scores: scoreRead(ref, vision), summary: summarizeScores(scoreRead(ref, vision)) } : {}) },
    production: { ai_calls: row.ai_calls, route: row.route, ...(ref && prod ? { scores: scoreRead(ref, prod), summary: summarizeScores(scoreRead(ref, prod)) } : {}) },
    rules_only: ref && row.rules_fields ? { summary: summarizeScores(scoreRead(ref, row.rules_fields)) } : null,
  };
}
