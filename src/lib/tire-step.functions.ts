/** Étape pneu — analyse IA (flanc + usure + profondeur expérimentale) et enregistrement. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MAX = 12 * 1024 * 1024;
const images = z.array(z.object({ role: z.enum(["tread", "sidewall", "other"]), dataUrl: z.string().min(20).max(MAX) })).min(1).max(6);

async function assertActive(supabase: { rpc: (f: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown }> }, userId: string) {
  const { data } = await supabase.rpc("is_active_user", { _user_id: userId });
  if (data !== true) throw new Error("Compte inactif.");
}

export const analyzeTireStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ images, force: z.boolean().default(false), siteId: z.string().uuid().nullable().optional() }).parse(v))
  .handler(async ({ data, context }) => {
    await assertActive(context.supabase, context.userId);
    const { runPaidAi, dailyBudgetStatus } = await import("./ai-usage.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { TIRE_STEP_PROMPT, TIRE_STEP_FEATURE, TIRE_STEP_DEFAULT_MODEL, normalizeTireStep } = await import("./tire-step");
    const { BENCH_MODELS } = await import("./bench-schema");
    const { data: s } = await supabaseAdmin.from("ai_bench_settings").select("candidate_model").maybeSingle();
    const model = s?.candidate_model && (BENCH_MODELS as readonly string[]).includes(s.candidate_model) ? s.candidate_model : TIRE_STEP_DEFAULT_MODEL;

    const label = { tread: "Photo bande de roulement", sidewall: "Photo du flanc", other: "Vue complémentaire" } as const;
    const content: Record<string, unknown>[] = [{ type: "text", text: TIRE_STEP_PROMPT }];
    for (const im of data.images) {
      content.push({ type: "text", text: label[im.role] });
      content.push({ type: "image_url", image_url: { url: im.dataUrl } });
    }
    const res = await runPaidAi({
      feature: TIRE_STEP_FEATURE,
      fingerprintSeed: data.images.map((i) => `${i.role}:${i.dataUrl}`).join("\u0000"),
      model,
      essentialVision: true,
      bypassCache: data.force,
      userId: context.userId,
      siteId: data.siteId ?? null,
      body: { messages: [{ role: "user", content }], response_format: { type: "json_object" } },
    });
    const budget = await dailyBudgetStatus();
    if (!res.ok) return { ok: false as const, error: res.error, model, budget, result: null, metrics: null };
    const { parseJsonBlock } = await import("./ocr.server");
    const parsed = parseJsonBlock(res.content);
    if (!parsed) return { ok: false as const, error: "Réponse IA illisible — relancez l'analyse ou saisissez les valeurs.", model, budget, result: null, metrics: null };
    return {
      ok: true as const, error: "", model, budget,
      result: normalizeTireStep(parsed),
      metrics: { cached: res.cached, credits: res.credits, durationMs: res.durationMs, tokensIn: res.tokensIn, tokensOut: res.tokensOut },
    };
  });

export const saveTireStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z.object({
      images, siteId: z.string().uuid().nullable(), plate: z.string().max(20).nullable(), orNumber: z.string().max(30).nullable(),
      position: z.string().max(10).nullable(), model: z.string().max(80), result: z.record(z.string(), z.unknown()), corrected: z.record(z.string(), z.unknown()),
      userName: z.string().max(120).nullable(),
    }).parse(v),
  )
  .handler(async ({ data, context }) => {
    await assertActive(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const paths: string[] = [];
    for (const [i, im] of data.images.entries()) {
      const m = im.dataUrl.match(/^data:(image\/[a-z+]+);base64,(.*)$/);
      if (!m) continue;
      const path = `etape-pneu/${stamp}/${i + 1}-${im.role}.${m[1] === "image/png" ? "png" : "jpg"}`;
      const bytes = Uint8Array.from(atob(m[2]!), (c) => c.charCodeAt(0));
      const { error } = await supabaseAdmin.storage.from("dda-media").upload(path, bytes, { contentType: m[1]! });
      if (error) throw new Error(`Stockage photo impossible : ${error.message}`);
      paths.push(path);
    }
    // Insertion avec le client utilisateur : RLS vérifie compte actif + accès au site.
    const { data: row, error } = await context.supabase.from("tire_step_analyses").insert({
      site_id: data.siteId, plate: data.plate?.toUpperCase().replace(/[^A-Z0-9]/g, "") || null, or_number: data.orNumber || null,
      position: data.position, photo_paths: paths, result: data.result as never, corrected: data.corrected as never,
      model: data.model, created_by: context.userId, created_by_name: data.userName,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const tireStepBudget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { dailyBudgetStatus } = await import("./ai-usage.server");
    return dailyBudgetStatus();
  });
