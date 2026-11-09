import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({ inspectionId: z.string().uuid(), siteId: z.string().uuid().nullable().optional(), force: z.boolean().default(false) });

export const analyzeTourTires = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => input.parse(v))
  .handler(async ({ data, context }) => {
    const { safeTireDiagnostic, tourTireAnalysisError } = await import("./tour-tire-analysis-error");
    let stage = "authorization";
    let wheel: string | null = null;
    let photoRole: string | null = null;
    const started = Date.now();
    try {
    const { data: active } = await context.supabase.rpc("is_active_user", { _user_id: context.userId });
    if (active !== true) throw new Error("Compte inactif.");
    const { TOUR_TIRE_KEYS, TOUR_ROLE_LABEL, TOUR_TIRES_PROMPT_VERSION, tourTiresPrompt, parseTourTiresResponse } = await import("./tour-tire-analysis");
    const { TIRE_STEP_DEFAULT_MODEL } = await import("./tire-step");
    stage = "load_points";
    const { data: points, error: pe } = await context.supabase.from("inspection_points")
      .select("id, point_key, battery_test, measure_value").eq("inspection_id", data.inspectionId).in("point_key", [...TOUR_TIRE_KEYS, "batterie"]);
    if (pe) throw new Error(pe.message);
    const byId = new Map((points ?? []).filter((p) => TOUR_TIRE_KEYS.includes(p.point_key as (typeof TOUR_TIRE_KEYS)[number])).map((p) => [p.id, p.point_key]));
    stage = "load_media";
    const { data: media, error: me } = await context.supabase.from("media")
      .select("id, inspection_point_id, storage_path, label, created_at")
      .eq("inspection_id", data.inspectionId).in("inspection_point_id", [...byId.keys()]).order("created_at", { ascending: false }).order("id", { ascending: false });
    if (me) throw new Error(me.message);
    const picked = new Map<string, { path: string; label: "bande" | "flanc" | "dimension" | "autre"; pointId: string; id: string }[]>();
    for (const m of media ?? []) {
      const key = m.inspection_point_id ? byId.get(m.inspection_point_id) : null;
      if (!key || !m.storage_path) continue;
      const arr = picked.get(key) ?? [];
      const role = /bande/i.test(m.label ?? "") ? "bande" : /flanc/i.test(m.label ?? "") ? "flanc" : /dimension|caract/i.test(m.label ?? "") ? "dimension" : "autre";
      if (m.inspection_point_id && role !== "autre" && !arr.some((x) => x.label === role)) arr.push({ path: m.storage_path, label: role, pointId: m.inspection_point_id, id: m.id });
      picked.set(key, arr);
    }
    const missing = TOUR_TIRE_KEYS.filter((k) => {
      const labels = new Set((picked.get(k) ?? []).map((x) => x.label));
      return !labels.has("bande") || !labels.has("flanc") || !labels.has("dimension");
    });
    if (missing.length) return { ok: false as const, error: `Photos pneus incomplètes : ${missing.join(", ")}. Trois photos sont requises par roue.`, results: null, model: TIRE_STEP_DEFAULT_MODEL, metrics: null };

    const battery = (points ?? []).find((p) => p.point_key === "batterie");
    const content: Record<string, unknown>[] = [{ type: "text", text: tourTiresPrompt(battery?.battery_test ?? battery?.measure_value ?? null) }];
    const proof: Record<string, { photoCount: number; mainPhotoPath: string | null; mainPhotoUrl: string | null }> = {};
    const usedIds: string[] = [];
    stage = "sign_media";
    for (const key of TOUR_TIRE_KEYS) {
      wheel = key;
      const ims = picked.get(key);
      if (!ims) throw new Error("Photos pneus indisponibles.");
      const mainPhotoPath = ims.find((x) => x.label === "bande")?.path ?? null;
      proof[key] = { photoCount: ims.length, mainPhotoPath, mainPhotoUrl: null };
      content.push({ type: "text", text: `ROUE ${key.toUpperCase()}` });
      for (const im of ims) {
        photoRole = im.label;
        // Original bytes never enter the Worker: twelve originals can exceed 42 MB
        // previously became base64 + binary strings + JSON copies and exhausted memory.
        // URLs are short-lived, scoped to the existing private objects under caller RLS.
        const { data: signed, error } = await context.supabase.storage.from("dda-media").createSignedUrl(im.path, 900);
        if (error || !signed?.signedUrl) throw new Error(`Photo ${key}/${im.label} momentanément inaccessible. Réessayez sans reprendre les photos.`);
        if (im.label === "bande") proof[key].mainPhotoUrl = signed.signedUrl;
        content.push({ type: "text", text: `${key.toUpperCase()} — ${TOUR_ROLE_LABEL[im.label as keyof typeof TOUR_ROLE_LABEL]}` });
        content.push({ type: "image_url", image_url: { url: signed.signedUrl } });
        usedIds.push(im.id);
      }
    }
    wheel = null; photoRole = null; stage = "ai_request";
    console.info("tour_tires_analysis", { stage, inspectionId: data.inspectionId, photoCount: usedIds.length, transport: "signed_urls", force: data.force });
    const { runPaidAi, dailyBudgetStatus } = await import("./ai-usage.server");
    const res = await runPaidAi({ feature: "tour_tires_global", entity: data.inspectionId, fingerprintSeed: `${TOUR_TIRES_PROMPT_VERSION}:${data.inspectionId}:${usedIds.join(":")}`, model: TIRE_STEP_DEFAULT_MODEL, essentialVision: true, bypassCache: data.force, userId: context.userId, siteId: data.siteId ?? null, body: { messages: [{ role: "user", content }], response_format: { type: "json_object" } } });
    const budget = await dailyBudgetStatus().catch(() => undefined);
    if (!res.ok) console.error("tour_tires_analysis", { stage, inspectionId: data.inspectionId, status: res.status ?? res.httpStatus ?? null, blocked: res.blocked ?? false });
    if (!res.ok) return { ok: false as const, error: res.error, results: null, model: TIRE_STEP_DEFAULT_MODEL, metrics: null, budget };
    const { parseJsonBlock } = await import("./ocr.server");
    stage = "parse_response";
    const parsed = parseTourTiresResponse(parseJsonBlock(res.content));
    if (!parsed.ok) {
      console.error("tour_tires_analysis", { stage, inspectionId: data.inspectionId, reason: "invalid_wheels_response" });
      return { ok: false as const, error: parsed.error, results: null, model: TIRE_STEP_DEFAULT_MODEL, metrics: null, budget };
    }
    return { ok: true as const, error: "", results: parsed.results, proof, model: TIRE_STEP_DEFAULT_MODEL, metrics: { credits: res.credits, durationMs: res.durationMs, tokensIn: res.tokensIn, tokensOut: res.tokensOut, cached: res.cached }, budget };
    } catch (error) {
      console.error("tour_tires_analysis", { stage, wheel, photoRole, inspectionId: data.inspectionId, elapsedMs: Date.now() - started, ...safeTireDiagnostic(error) });
      return { ok: false as const, error: tourTireAnalysisError(error), results: null, model: "", metrics: null };
    }
  });