import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({ inspectionId: z.string().uuid(), siteId: z.string().uuid().nullable().optional(), force: z.boolean().default(false) });

export const analyzeTourTires = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => input.parse(v))
  .handler(async ({ data, context }) => {
    const { data: active } = await context.supabase.rpc("is_active_user", { _user_id: context.userId });
    if (active !== true) throw new Error("Compte inactif.");
    const { TOUR_TIRE_KEYS } = await import("./tour-tire-analysis");
    const { TIRE_STEP_DEFAULT_MODEL, normalizeTireStep } = await import("./tire-step");
    const { data: points, error: pe } = await context.supabase.from("inspection_points")
      .select("id, point_key").eq("inspection_id", data.inspectionId).in("point_key", [...TOUR_TIRE_KEYS]);
    if (pe) throw new Error(pe.message);
    const byId = new Map((points ?? []).map((p) => [p.id, p.point_key]));
    const { data: media, error: me } = await context.supabase.from("media")
      .select("id, inspection_point_id, storage_path, label, created_at")
      .eq("inspection_id", data.inspectionId).in("inspection_point_id", [...byId.keys()]).order("created_at", { ascending: false });
    if (me) throw new Error(me.message);
    const picked = new Map<string, { path: string; label: string; pointId: string }[]>();
    for (const m of media ?? []) {
      const key = m.inspection_point_id ? byId.get(m.inspection_point_id) : null;
      if (!key || !m.storage_path) continue;
      const arr = picked.get(key) ?? [];
      const role = /bande/i.test(m.label ?? "") ? "bande" : /flanc/i.test(m.label ?? "") ? "flanc" : /dimension|caract/i.test(m.label ?? "") ? "dimension" : "autre";
      if (!arr.some((x) => x.label === role)) arr.push({ path: m.storage_path, label: role, pointId: m.inspection_point_id! });
      picked.set(key, arr);
    }
    const missing = TOUR_TIRE_KEYS.filter((k) => {
      const labels = new Set((picked.get(k) ?? []).map((x) => x.label));
      return !labels.has("bande") || !labels.has("flanc") || !labels.has("dimension");
    });
    if (missing.length) return { ok: false as const, error: `Photos pneus incomplètes : ${missing.join(", ")}. Trois photos sont requises par roue.`, results: null, model: TIRE_STEP_DEFAULT_MODEL, metrics: null };

    const content: Record<string, unknown>[] = [{ type: "text", text: `Analyse les QUATRE pneus d'un même véhicule dans UNE réponse. Pour chaque roue, lis le flanc, évalue l'usure et estime prudemment les profondeurs gauche/milieu/droite. N'invente rien. Les défauts critiques (lisse, témoin atteint, carcasse ou corde visible) priment. Réponds strictement en JSON {"wheels":{"pneu_avg":RESULTAT,"pneu_avd":RESULTAT,"pneu_arg":RESULTAT,"pneu_ard":RESULTAT}} où RESULTAT suit exactement le schéma État pneus sidewall/wear/depth.` }];
    const proof: Record<string, { photoCount: number; mainPhotoPath: string | null }> = {};
    for (const key of TOUR_TIRE_KEYS) {
      const ims = picked.get(key)!;
      proof[key] = { photoCount: ims.length, mainPhotoPath: ims.find((x) => x.label === "bande")?.path ?? null };
      content.push({ type: "text", text: `ROUE ${key.toUpperCase()}` });
      for (const im of ims) {
        const { data: blob, error } = await context.supabase.storage.from("dda-media").download(im.path);
        if (error || !blob) throw new Error(`Photo ${key}/${im.label} indisponible.`);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = ""; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        content.push({ type: "text", text: im.label });
        content.push({ type: "image_url", image_url: { url: `data:${blob.type || "image/jpeg"};base64,${btoa(binary)}` } });
      }
    }
    const { runPaidAi, dailyBudgetStatus } = await import("./ai-usage.server");
    const res = await runPaidAi({ feature: "tour_tires_global", fingerprintSeed: `${data.inspectionId}:${(media ?? []).map((m) => m.id).join(":")}`, model: TIRE_STEP_DEFAULT_MODEL, essentialVision: true, bypassCache: data.force, userId: context.userId, siteId: data.siteId ?? null, body: { messages: [{ role: "user", content }], response_format: { type: "json_object" } } });
    const budget = await dailyBudgetStatus();
    if (!res.ok) return { ok: false as const, error: res.error, results: null, model: TIRE_STEP_DEFAULT_MODEL, metrics: null, budget };
    const { parseJsonBlock } = await import("./ocr.server");
    const raw = parseJsonBlock(res.content) as { wheels?: Record<string, Record<string, unknown>> } | null;
    if (!raw?.wheels) return { ok: false as const, error: "Réponse IA illisible — relancez sans reprendre les photos.", results: null, model: TIRE_STEP_DEFAULT_MODEL, metrics: null, budget };
    const results: Record<string, ReturnType<typeof normalizeTireStep>> = {};
    for (const key of TOUR_TIRE_KEYS) results[key] = normalizeTireStep(raw.wheels[key] ?? null);
    return { ok: true as const, error: "", results, proof, model: TIRE_STEP_DEFAULT_MODEL, metrics: { credits: res.credits, durationMs: res.durationMs, tokensIn: res.tokensIn, tokensOut: res.tokensOut, cached: res.cached }, budget };
  });