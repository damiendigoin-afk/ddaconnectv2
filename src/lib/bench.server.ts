/**
 * Recette IA — logique serveur ISOLÉE du métier.
 * Écritures autorisées : stockage dda-media/benchmark/*, ai_usage_log (via runPaidAi). Rien d'autre.
 * Ne JAMAIS importer ici un module qui crée/modifie commandes, réceptions, OR, véhicules, fournisseurs
 * ou profils fournisseurs (learnSupplierProfile exclu volontairement).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { BENCH_FEATURE, runPaidAi, spentSince, type PaidAiResult } from "./ai-usage.server";
import { readDocument } from "./doc-pipeline.server";
import {
  BENCH_PROMPT_VERSION, BENCH_SCHEMA_VERSION, MODEL_A, classifyPrompt, enforceTireDepthRule, extractionPrompt,
  isAllowedBenchModel, parseModelJson, pipelineKind, sha256Hex, BENCH_KIND_KEYS, type BenchKind, type BenchOutput,
} from "./bench-schema";
import type { BenchRun, BenchVariant } from "./bench-export";
import { VISION_MODEL } from "./ocr.server";

export const BENCH_BUCKET = "dda-media";
export const BENCH_PREFIX = "benchmark/";

export async function assertManager(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "manager" });
  if (error || data !== true) throw new Error("Accès réservé aux gérants.");
}

export function assertBenchPath(p: string) {
  if (!p.startsWith(BENCH_PREFIX) || p.includes("..")) throw new Error("Chemin de média invalide.");
}

type Settings = { candidate_model: string; daily_credits: number; max_credits_per_test: number };

export async function readBenchSettings(supabase: SupabaseClient): Promise<Settings> {
  const { data } = await supabase.from("ai_bench_settings").select("candidate_model, daily_credits, max_credits_per_test").maybeSingle();
  return {
    candidate_model: isAllowedBenchModel(data?.candidate_model) ? data!.candidate_model : "google/gemini-3.8-flash",
    daily_credits: Number(data?.daily_credits ?? 3),
    max_credits_per_test: Number(data?.max_credits_per_test ?? 1),
  };
}

/** Budget benchmark séparé : jamais compté dans le budget prod, jamais bloquant pour la prod. */
export async function checkBenchBudget(supabase: SupabaseClient): Promise<string | null> {
  const s = await readBenchSettings(supabase);
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const spent = await spentSince(day, "benchmark");
  return spent >= s.daily_credits ? `Budget journalier du banc de test atteint (${spent.toFixed(2)} / ${s.daily_credits} crédits).` : null;
}

/* --------------------------------- Média ---------------------------------- */

export type MediaItem = { dataUrl: string; mime: string; name: string };

export async function storeMedia(sha: string, items: { dataUrl: string; name: string }[]): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const paths: string[] = [];
  for (const [i, it] of items.entries()) {
    const m = it.dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    if (!m) throw new Error("Média invalide.");
    const mime = m[1]!;
    const ext = mime === "application/pdf" ? "pdf" : mime.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
    const path = `${BENCH_PREFIX}${sha}/${i + 1}.${ext}`;
    const bytes = Uint8Array.from(atob(m[2]!), (c) => c.charCodeAt(0));
    const { error } = await supabaseAdmin.storage.from(BENCH_BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
    if (error) throw new Error(`Stockage du média impossible : ${error.message}`);
    paths.push(path);
  }
  return paths;
}

export async function loadMedia(paths: string[]): Promise<MediaItem[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const out: MediaItem[] = [];
  for (const p of paths) {
    assertBenchPath(p);
    const { data, error } = await supabaseAdmin.storage.from(BENCH_BUCKET).download(p);
    if (error || !data) throw new Error("Média du test introuvable.");
    const buf = new Uint8Array(await data.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const mime = data.type || (p.endsWith(".pdf") ? "application/pdf" : "image/jpeg");
    out.push({ dataUrl: `data:${mime};base64,${btoa(bin)}`, mime, name: p.split("/").pop()! });
  }
  return out;
}

export async function signedUrl(path: string): Promise<string | null> {
  assertBenchPath(path);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.storage.from(BENCH_BUCKET).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

function blocks(media: MediaItem[]) {
  return media.map((m) =>
    m.mime === "application/pdf"
      ? { type: "file", file: { filename: m.name, file_data: m.dataUrl } }
      : { type: "image_url", image_url: { url: m.dataUrl } },
  );
}

/* ----------------------------- Classification ----------------------------- */

export async function classifyWithAi(media: MediaItem[], bypassCache: boolean) {
  const prompt = classifyPrompt();
  const res = await runPaidAi({
    feature: `${BENCH_FEATURE}:classify`,
    benchmark: true,
    bypassCache,
    route: "ai_vision_fallback",
    fingerprintSeed: `${prompt}\u0000${media.map((m) => m.dataUrl.slice(-2000) + m.dataUrl.length).join("|")}`,
    model: MODEL_A,
    body: { messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...blocks(media)] }] },
  });
  if (!res.ok) return { kind: null, confidence: null, error: res.error, credits: 0 };
  const j = parseModelJson(res.content) as { kind?: string; confidence?: number } | null;
  const kind = BENCH_KIND_KEYS.includes(j?.kind as BenchKind) ? (j!.kind as BenchKind) : "other";
  const confidence = typeof j?.confidence === "number" ? Math.max(0, Math.min(1, j.confidence)) : null;
  return { kind, confidence, error: null, credits: res.credits };
}

/* ------------------------------- Lancements ------------------------------- */

function failureFrom(res: PaidAiResult | null, parsed: BenchOutput | null): string | null {
  if (!res) return "reponse_vide";
  if (!res.ok) {
    if (res.blocked && !res.status) return "budget";
    if (res.status === 499 || res.status === 504) return "timeout";
    return res.status ? `http_error:${res.status}` : "http_error";
  }
  if (!res.content) return "reponse_vide";
  if (!parsed) return "json_invalide";
  return null;
}

/** Modèle brut A ou B : même média, même invite, même schéma. */
export async function runModel(opts: { variant: "A" | "B"; model: string; kind: BenchKind; media: MediaItem[]; bypassCache: boolean; mediaMs: number }): Promise<BenchRun> {
  const t0 = Date.now();
  const prompt = extractionPrompt(opts.kind);
  const promptHash = await sha256Hex(prompt);
  const startedAt = new Date().toISOString();
  const res = await runPaidAi({
    feature: `${BENCH_FEATURE}:${opts.variant}`,
    benchmark: true,
    bypassCache: opts.bypassCache,
    route: "ai_vision_fallback",
    // Empreinte spécifique banc de test : jamais partagée avec les caches métier.
    fingerprintSeed: `${BENCH_SCHEMA_VERSION}\u0000${promptHash}\u0000${opts.media.map((m) => m.dataUrl).join("\u0000")}`,
    model: opts.model,
    body: { messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...blocks(opts.media)] }] },
  });
  const p0 = Date.now();
  const raw = res.ok ? res.content : "";
  const parsedRaw = raw ? parseModelJson(raw) : null;
  const parsed = parsedRaw ? enforceTireDepthRule(parsedRaw) : null;
  const parseMs = Date.now() - p0;
  return {
    variant: opts.variant,
    model: opts.model,
    promptVersion: BENCH_PROMPT_VERSION,
    promptHash,
    promptText: prompt,
    schemaVersion: BENCH_SCHEMA_VERSION,
    docKind: opts.kind,
    startedAt,
    mediaMs: opts.mediaMs,
    aiMs: res.durationMs ?? 0,
    parseMs,
    serverMs: Date.now() - t0 + opts.mediaMs,
    totalMs: null,
    tokensIn: res.tokensIn ?? 0,
    tokensOut: res.tokensOut ?? 0,
    credits: res.ok ? res.credits : 0,
    httpStatus: res.httpStatus ?? (res.ok ? 200 : (res.status ?? null)),
    success: res.ok && !!parsed,
    cacheHit: res.ok ? res.cached : false,
    failureReason: failureFrom(res, parsed),
    route: "ai_vision_fallback",
    aiCalls: res.ok && res.cached ? 0 : 1,
    parsed,
    rawText: raw || (!res.ok ? res.error : ""),
  };
}

/** Invites figées du pipeline réel (copies des invites production, version pipeline-v1). */
const PIPELINE_PROMPTS: Record<string, string> = {
  purchase: `Tu lis un document d'achat de pièces automobiles (France) : bon de commande, BL, facture ou avoir. Réponds STRICTEMENT en JSON :
{"doc_kind":null,"supplier":null,"document_number":null,"document_date":null,"order_reference":null,"delivery_note_number":null,"invoice_number":null,"or_number":null,"plate":null,
"lines":[{"reference":null,"label":null,"quantity":null,"unit_price":null,"amount":null}],"total_ht":null,"vat_amount":null,"total_ttc":null}
supplier = émetteur, jamais le garage destinataire. Dates ISO. Nombres avec point. Null si absent. N'invente rien.`,
  repair_order: `Tu analyses un ordre de réparation d'un garage automobile français. Réponds STRICTEMENT en JSON :
{"client":{"last_name":null,"first_name":null,"address":null,"postal_code":null,"city":null,"phone":null,"mobile":null,"email":null},
"vehicle":{"plate":null,"vin":null,"brand":null,"model":null,"mileage":null},"order":{"or_number":null,"or_date":null,"client_remarks":null,"requested_work":null}}
L'en-tête du garage et « votre conseiller » ne sont jamais le client. Null si absent. N'invente rien.`,
  battery: `Tu lis le ticket d'un testeur de batterie. Réponds STRICTEMENT en JSON :
{"verdict":null,"voltage":null,"cca_measured":null,"cca_rated":null,"soh_pct":null,"soc_pct":null}. Null si illisible.`,
  expense: `Ticket de caisse / note de frais. Réponds STRICTEMENT en JSON : {"merchant":null,"date":null,"amount_ttc":null,"vat_amount":null,"vat_rate":null,"category":null}. Null si absent.`,
  any_document: `Document d'atelier automobile. Réponds STRICTEMENT en JSON : {"doc_kind":null,"plate":null,"vin":null,"or_number":null,"customer_name":null,"customer_phone":null,"customer_email":null,"brand":null,"model":null,"mileage":null,"amount_ht":null,"document_date":null}. Null si absent.`,
};
export const PIPELINE_PROMPT_VERSION = "pipeline-v1";

const str = (v: unknown) => (v == null || v === "" ? null : typeof v === "object" ? null : (v as string | number | boolean));
const at = (o: unknown, ...k: string[]) => k.reduce<unknown>((a, x) => (a && typeof a === "object" ? (a as Record<string, unknown>)[x] : undefined), o);

/** Convertit la sortie du pipeline DDA vers le schéma benchmark (comparaison possible). */
export function pipelineToBench(kind: BenchKind, f: Record<string, unknown>): BenchOutput {
  const lines = Array.isArray(f["lines"]) ? (f["lines"] as Record<string, unknown>[]) : [];
  return {
    document_type: kind,
    document: {
      supplier: str(f["supplier"]) as string | null,
      client: str(at(f, "client", "last_name")) ?? str(f["customer_name"]),
      phone: str(at(f, "client", "phone")) ?? str(at(f, "client", "mobile")) ?? str(f["customer_phone"]),
      email: str(at(f, "client", "email")) ?? str(f["customer_email"]),
      document_number: str(f["document_number"]),
      delivery_note_number: str(f["delivery_note_number"]),
      order_number: str(f["order_reference"]),
      invoice_number: str(f["invoice_number"]),
      date: str(f["document_date"]) ?? str(at(f, "order", "or_date")) ?? str(f["date"]),
      or_number: str(f["or_number"]) ?? str(at(f, "order", "or_number")),
      plate: str(f["plate"]) ?? str(at(f, "vehicle", "plate")),
      vin: str(f["vin"]) ?? str(at(f, "vehicle", "vin")),
      mileage: str(f["mileage"]) ?? str(at(f, "vehicle", "mileage")),
    },
    lines: lines.map((l) => ({ reference: str(l["reference"]), label: str(l["label"]), quantity: str(l["quantity"]), unit_price_ht: str(l["unit_price"]), amount_ht: str(l["amount"]) })),
    totals: { ht: str(f["total_ht"]) ?? str(f["amount_ht"]), vat: str(f["vat_amount"]), ttc: str(f["total_ttc"]) ?? str(f["amount_ttc"]) },
    battery: kind === "battery" ? { verdict: str(f["verdict"]), voltage: str(f["voltage"]), cca_measured: str(f["cca_measured"]), cca_rated: str(f["cca_rated"]), soh_pct: str(f["soh_pct"]), soc_pct: str(f["soc_pct"]) } : {},
    workshop: kind === "repair_order" ? { brand: str(at(f, "vehicle", "brand")), model: str(at(f, "vehicle", "model")), requested_work: str(at(f, "order", "requested_work")), observations: str(at(f, "order", "client_remarks")), or_number: str(at(f, "order", "or_number")) } : {},
  };
}

/** Pipeline réel DDA (OCR/règles + IA comme en prod), sans apprentissage fournisseur ni écriture métier. */
export async function runPipeline(opts: { kind: BenchKind; media: MediaItem[]; text: string; bypassCache: boolean; mediaMs: number }): Promise<BenchRun> {
  const t0 = Date.now();
  const startedAt = new Date().toISOString();
  const dk = pipelineKind(opts.kind);
  const base = {
    variant: "pipeline" as BenchVariant, model: VISION_MODEL, promptVersion: PIPELINE_PROMPT_VERSION, schemaVersion: BENCH_SCHEMA_VERSION,
    docKind: opts.kind, startedAt, mediaMs: opts.mediaMs, totalMs: null, httpStatus: null as number | null,
  };
  if (!dk) {
    return { ...base, promptHash: "", promptText: "", aiMs: 0, parseMs: 0, serverMs: 0, tokensIn: 0, tokensOut: 0, credits: 0, success: false, cacheHit: false,
      failureReason: "non_applicable", route: "ocr_local_navigateur", aiCalls: 0, parsed: null,
      rawText: "Pneus : en production la lecture est faite par OCR local dans le navigateur (aucun appel IA). Pas de pipeline serveur à comparer." };
  }
  const prompt = PIPELINE_PROMPTS[dk] ?? PIPELINE_PROMPTS["any_document"]!;
  const first = opts.media[0];
  const ai = { ms: 0, tin: 0, tout: 0, credits: 0, http: null as number | null, cache: false, raw: [] as string[] };
  const r = await readDocument({
    feature: `${BENCH_FEATURE}:pipeline`,
    kind: dk,
    prompt,
    text: opts.text,
    dataUrl: first?.dataUrl ?? null,
    filename: first?.name,
    bench: {
      bypassCache: opts.bypassCache,
      onAi: (route, res) => {
        ai.ms += res.durationMs ?? 0;
        ai.tin += res.tokensIn ?? 0;
        ai.tout += res.tokensOut ?? 0;
        if (res.ok) { ai.credits += res.credits; ai.cache ||= res.cached; ai.raw.push(`[${route}] ${res.content}`); }
        else ai.raw.push(`[${route}] ERREUR ${res.error}`);
        ai.http = res.httpStatus ?? (res.ok ? 200 : (res.status ?? null));
      },
    },
  });
  const p0 = Date.now();
  const parsed = pipelineToBench(opts.kind, r.fields as Record<string, unknown>);
  const any = Object.keys(r.fields).length > 0;
  return {
    ...base,
    httpStatus: ai.http,
    promptHash: await sha256Hex(prompt),
    promptText: prompt,
    aiMs: ai.ms,
    parseMs: Date.now() - p0,
    serverMs: Date.now() - t0 + opts.mediaMs,
    tokensIn: ai.tin,
    tokensOut: ai.tout,
    credits: Math.round(ai.credits * 10000) / 10000,
    success: any && r.missing.length === 0,
    cacheHit: ai.cache,
    failureReason: !any ? "champ_absent" : r.missing.length ? `champ_absent:${r.missing.join(",")}` : null,
    route: r.route,
    aiCalls: r.aiCalls,
    parsed,
    rawText: JSON.stringify({ fields: r.fields, missing: r.missing, ai_responses: ai.raw }, null, 2),
  };
}
