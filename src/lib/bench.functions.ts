/** Recette IA — fonctions serveur (gérants uniquement). Aucune écriture métier. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BENCH_KIND_KEYS, BENCH_MODELS, MODEL_A, isAllowedBenchModel, type BenchKind } from "./bench-schema";
import type { BenchRun } from "./bench-export";

const kindEnum = z.enum(BENCH_KIND_KEYS as [BenchKind, ...BenchKind[]]);
const MAX_ITEM = 20 * 1024 * 1024 * 1.4; // ~20 Mo en base64

export const benchSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z.object({ candidate_model: z.string().optional(), max_credits_per_test: z.number().min(0).max(100).optional() }).parse(v ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { assertManager, readBenchSettings } = await import("./bench.server");
    await assertManager(context.supabase, context.userId);
    if (Object.keys(data).length) {
      if (data.candidate_model && !isAllowedBenchModel(data.candidate_model)) throw new Error("Modèle non autorisé en V1.");
      const cur = await readBenchSettings(context.supabase);
      const { error } = await context.supabase.from("ai_bench_settings").upsert({ id: true, ...cur, ...(Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as Partial<typeof cur>), updated_at: new Date().toISOString(), updated_by: context.userId });
      if (error) throw new Error(error.message);
    }
    const s = await readBenchSettings(context.supabase);
    const { dailyBudgetStatus } = await import("./ai-usage.server");
    const budget = await dailyBudgetStatus();
    return { ...s, daily_credits: budget.daily, budget, modelA: MODEL_A, models: [...BENCH_MODELS] };
  });

/** Stocke le média (une fois, commun à A/B/pipeline) puis classe le document. */
export const benchPrepare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z.object({
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      items: z.array(z.object({ dataUrl: z.string().max(MAX_ITEM), name: z.string().max(200) })).min(1).max(5),
      localKind: kindEnum.nullable(),
      localConfidence: z.number().nullable(),
      forceAi: z.boolean().default(false),
    }).parse(v),
  )
  .handler(async ({ data, context }) => {
    const b = await import("./bench.server");
    await b.assertManager(context.supabase, context.userId);
    const t0 = Date.now();
    const paths = await b.storeMedia(data.sha256, data.items);
    const storeMs = Date.now() - t0;
    const { LOCAL_CLASSIFY_THRESHOLD } = await import("./bench-classify");
    if (!data.forceAi && data.localKind && (data.localConfidence ?? 0) >= LOCAL_CLASSIFY_THRESHOLD) {
      return { paths, storeMs, kind: data.localKind, confidence: data.localConfidence, source: "local", error: null as string | null };
    }
    const budget = await b.checkBenchBudget(context.supabase);
    if (budget) return { paths, storeMs, kind: data.localKind ?? "other", confidence: data.localConfidence, source: "local", error: budget };
    const media = await b.loadMedia(paths);
    const c = await b.classifyWithAi(media, true);
    return { paths, storeMs, kind: (c.kind ?? data.localKind ?? "other") as BenchKind, confidence: c.confidence, source: c.kind ? "ia" : "local", error: c.error };
  });

export const benchRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z.object({
      variant: z.enum(["A", "B", "pipeline"]),
      model: z.string().optional(),
      kind: kindEnum,
      paths: z.array(z.string()).min(1).max(5),
      text: z.string().max(40000).default(""),
      bypassCache: z.boolean().default(true),
    }).parse(v),
  )
  .handler(async ({ data, context }): Promise<BenchRun> => {
    const b = await import("./bench.server");
    await b.assertManager(context.supabase, context.userId);
    data.paths.forEach(b.assertBenchPath);
    const budget = await b.checkBenchBudget(context.supabase);
    if (budget) throw new Error(budget);
    const m0 = Date.now();
    const media = await b.loadMedia(data.paths);
    const mediaMs = Date.now() - m0;
    if (data.variant === "pipeline") return b.runPipeline({ kind: data.kind, media, text: data.text, bypassCache: data.bypassCache, mediaMs });
    const model = data.variant === "A" ? MODEL_A : data.model;
    if (!isAllowedBenchModel(model)) throw new Error("Modèle B non autorisé en V1 (Gemini vision uniquement).");
    return b.runModel({ variant: data.variant, model, kind: data.kind, media, bypassCache: data.bypassCache, mediaMs });
  });

const runSchema = z.object({
  variant: z.enum(["A", "B", "pipeline"]), model: z.string(), promptVersion: z.string(), promptHash: z.string(), promptText: z.string(),
  schemaVersion: z.string(), docKind: z.string(), startedAt: z.string(), mediaMs: z.number(), aiMs: z.number(), parseMs: z.number(),
  serverMs: z.number(), totalMs: z.number().nullable(), tokensIn: z.number(), tokensOut: z.number(), credits: z.number(),
  httpStatus: z.number().nullable(), success: z.boolean(), cacheHit: z.boolean(), failureReason: z.string().nullable(),
  route: z.string().nullable(), aiCalls: z.number(), parsed: z.any(), rawText: z.string(),
});

export const benchSaveTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z.object({
      campaignId: z.string().uuid().nullable(),
      campaignName: z.string().max(120).optional(),
      test: z.object({
        file_name: z.string().max(300), mime: z.string().max(100), sha256: z.string(), storage_paths: z.array(z.string()),
        page_count: z.number().nullable(), photo_count: z.number(), detected_kind: z.string().nullable(), kind_confidence: z.number().nullable(),
        kind_source: z.string().nullable(), corrected_kind: z.string().nullable(), local_text_chars: z.number(), expected: z.any().nullable(),
        scores: z.any().nullable(), timings: z.any(), app_version: z.string().nullable(),
      }),
      runs: z.array(runSchema).max(3),
    }).parse(v),
  )
  .handler(async ({ data, context }) => {
    const { assertManager } = await import("./bench.server");
    await assertManager(context.supabase, context.userId);
    const sb = context.supabase;
    let campaignId = data.campaignId;
    if (!campaignId) {
      const { data: c, error } = await sb.from("ai_bench_campaigns")
        .insert({ name: data.campaignName?.trim() || `Recette IA ${new Date().toLocaleDateString("fr-FR")}`, model_a: MODEL_A, model_b: data.runs.find((r) => r.variant === "B")?.model ?? null, created_by: context.userId })
        .select("id").single();
      if (error) throw new Error(error.message);
      campaignId = c.id;
    }
    const { data: t, error } = await sb.from("ai_bench_tests").insert({ ...data.test, campaign_id: campaignId, created_by: context.userId }).select("id").single();
    if (error) throw new Error(error.message);
    if (data.runs.length) {
      const { error: e2 } = await sb.from("ai_bench_runs").insert(data.runs.map((r) => ({
        test_id: t.id, variant: r.variant, model: r.model, prompt_version: r.promptVersion, prompt_hash: r.promptHash, prompt_text: r.promptText,
        schema_version: r.schemaVersion, doc_kind: r.docKind, started_at: r.startedAt, media_ms: r.mediaMs, ai_ms: r.aiMs, parse_ms: r.parseMs,
        server_ms: r.serverMs, total_ms: r.totalMs, tokens_in: r.tokensIn, tokens_out: r.tokensOut, credits: r.credits, http_status: r.httpStatus,
        success: r.success, cache_hit: r.cacheHit, failure_reason: r.failureReason, route: r.route, ai_calls: r.aiCalls, parsed: r.parsed ?? null, raw_text: r.rawText,
      })));
      if (e2) throw new Error(e2.message);
    }
    return { campaignId, testId: t.id };
  });

export const benchCampaigns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertManager } = await import("./bench.server");
    await assertManager(context.supabase, context.userId);
    const { data, error } = await context.supabase.from("ai_bench_campaigns").select("id, name, model_a, model_b, created_at").order("created_at", { ascending: false }).limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Campagne complète (tests + lancements) pour synthèse et export. */
export const benchCampaignDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ campaignId: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    const { assertManager } = await import("./bench.server");
    await assertManager(context.supabase, context.userId);
    const sb = context.supabase;
    const { data: campaign } = await sb.from("ai_bench_campaigns").select("*").eq("id", data.campaignId).maybeSingle();
    const { data: tests } = await sb.from("ai_bench_tests").select("*").eq("campaign_id", data.campaignId).order("created_at");
    const ids = (tests ?? []).map((t) => t.id);
    const { data: runs } = ids.length ? await sb.from("ai_bench_runs").select("*").in("test_id", ids) : { data: [] };
    return { campaign, tests: tests ?? [], runs: runs ?? [] };
  });

export const benchMediaUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ path: z.string() }).parse(v))
  .handler(async ({ data, context }) => {
    const b = await import("./bench.server");
    await b.assertManager(context.supabase, context.userId);
    return { url: await b.signedUrl(data.path) };
  });
