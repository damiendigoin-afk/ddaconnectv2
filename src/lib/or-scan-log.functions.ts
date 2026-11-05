/**
 * Journal privé du scan OR : photo (bucket privé or-scans, jamais public), étapes de lecture,
 * doutes, corrections opérateur. Rétention 30 jours (expires_at) avec purge à chaque nouvel envoi.
 * Aucune donnée personnelle n'est écrite dans les journaux généraux (console / ai_usage_log).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "or-scans";
const MAX_PHOTO = 9 * 1024 * 1024 * 1.4;
const json = z.record(z.string(), z.unknown());

async function assertManager(context: { supabase: { rpc: Function }; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "manager" });
  if (!data) throw new Error("Accès réservé aux gérants.");
}

/** Purge des journaux expirés (photos comprises). Silencieuse : n'empêche jamais un scan. */
async function purgeExpired() {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("or_scan_logs").select("id, photo_path").lt("expires_at", new Date().toISOString()).limit(200);
    if (!data?.length) return;
    const paths = data.map((r) => r.photo_path).filter((p): p is string => !!p);
    if (paths.length) await supabaseAdmin.storage.from(BUCKET).remove(paths);
    await supabaseAdmin.from("or_scan_logs").delete().in("id", data.map((r) => r.id));
  } catch {
    console.error("or_scan purge failed");
  }
}

/** Enregistre la photo et la trace de lecture. Renvoie l'id du journal (ou null si impossible, sans bloquer). */
export const recordOrScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z.object({
      siteId: z.string().uuid(),
      entry: z.enum(["atelier", "tour"]),
      userName: z.string().max(120).nullable().optional(),
      dataUrl: z.string().max(MAX_PHOTO).nullable().optional(),
      orNumber: z.string().max(20).nullable().optional(),
      trace: z.object({
        local_text_len: z.number().int().nullable().optional(),
        route: z.string().max(40).nullable().optional(),
        ai_calls: z.number().int().nullable().optional(),
        missing: z.array(z.string().max(60)).max(40).optional(),
        rules_fields: json.nullable().optional(),
      }),
      readFields: json.nullable().optional(),
      doubts: z.array(json).max(20).optional(),
    }).parse(v),
  )
  .handler(async ({ data, context }) => {
    const { data: ok } = await context.supabase.rpc("user_can_access_site", { _user_id: context.userId, _site_id: data.siteId });
    if (!ok) return { id: null as string | null };
    let photo_path: string | null = null;
    const m = data.dataUrl ? /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(data.dataUrl) : null;
    if (m) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const bytes = Uint8Array.from(atob(m[2]!), (c) => c.charCodeAt(0));
        const path = `${data.siteId}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${m[1] === "image/png" ? "png" : m[1] === "image/webp" ? "webp" : "jpg"}`;
        const up = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, { contentType: m[1], upsert: false });
        if (!up.error) photo_path = path;
      } catch {
        console.error("or_scan photo upload failed");
      }
    }
    const { data: row, error } = await context.supabase.from("or_scan_logs").insert({
      site_id: data.siteId, user_id: context.userId, user_name: data.userName ?? null, entry: data.entry,
      or_number: data.orNumber ?? null, photo_path, local_text_len: data.trace.local_text_len ?? null,
      route: data.trace.route ?? null, ai_calls: data.trace.ai_calls ?? null, missing: data.trace.missing ?? [],
      rules_fields: (data.trace.rules_fields ?? null) as never, read_fields: (data.readFields ?? null) as never,
      doubts: (data.doubts ?? []) as never,
    }).select("id").single();
    if (error) console.error("or_scan log insert failed");
    void purgeExpired();
    return { id: (row?.id as string | undefined) ?? null };
  });

/** Clôture : champs confirmés, liste des champs corrigés (noms seulement), issue, OR rattaché. */
export const finalizeOrScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z.object({
      id: z.string().uuid(),
      confirmedFields: json.nullable().optional(),
      corrections: z.array(z.string().max(40)).max(20).optional(),
      outcome: z.string().max(40),
      repairOrderId: z.string().uuid().nullable().optional(),
    }).parse(v),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("or_scan_logs").update({
      confirmed_fields: (data.confirmedFields ?? null) as never, corrections: data.corrections ?? [],
      outcome: data.outcome, repair_order_id: data.repairOrderId ?? null,
    }).eq("id", data.id);
    if (error) console.error("or_scan finalize failed");
    return { ok: !error };
  });

/** Liste gérant (site accessible, RLS), sans texte OCR brut. */
export const listOrScans = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ siteId: z.string().uuid().nullable().optional() }).parse(v ?? {}))
  .handler(async ({ data, context }) => {
    await assertManager(context as never);
    let q = context.supabase.from("or_scan_logs")
      .select("id, created_at, expires_at, site_id, user_name, entry, or_number, repair_order_id, photo_path, local_text_len, route, ai_calls, missing, doubts, corrections, outcome, bench, bench_consent, read_fields, confirmed_fields, rules_fields")
      .order("created_at", { ascending: false }).limit(100);
    if (data.siteId) q = q.eq("site_id", data.siteId);
    const { data: rows, error } = await q;
    if (error) throw new Error("Lecture du journal impossible.");
    return rows ?? [];
  });

/** URL signée 5 minutes pour la photo (gérant, site accessible via RLS). */
export const orScanPhotoUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    await assertManager(context as never);
    const { data: row } = await context.supabase.from("or_scan_logs").select("photo_path").eq("id", data.id).maybeSingle();
    if (!row?.photo_path) return { url: null as string | null };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: s } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(row.photo_path, 300);
    return { url: s?.signedUrl ?? null };
  });

/** Accord explicite du gérant pour inclure cette photo dans le banc comparatif. */
export const setOrScanBenchConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ id: z.string().uuid(), consent: z.boolean() }).parse(v))
  .handler(async ({ data, context }) => {
    await assertManager(context as never);
    const { error } = await context.supabase.from("or_scan_logs").update({ bench_consent: data.consent }).eq("id", data.id);
    return { ok: !error };
  });

/**
 * Banc comparatif isolé : relance la photo conservée en « vision d'abord » (sans cache) et la compare,
 * champ par champ, à la lecture production enregistrée et à la référence confirmée par l'opérateur.
 * Aucun effet métier : n'écrit que la colonne bench du journal et ai_usage_log (feature ai_document_benchmark_or).
 */
export const runOrScanBench = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    await assertManager(context as never);
    const { data: row } = await context.supabase.from("or_scan_logs").select("id, photo_path, read_fields, confirmed_fields, rules_fields, ai_calls, route, bench_consent").eq("id", data.id).maybeSingle();
    if (!row?.photo_path) throw new Error("Photo indisponible (expirée ou non conservée).");
    if (!row.bench_consent) throw new Error("Accord requis avant d'utiliser cette photo dans le banc.");
    const { runOrBenchVision } = await import("./or-scan-bench.server");
    const bench = await runOrBenchVision(row as never);
    await context.supabase.from("or_scan_logs").update({ bench: bench as never }).eq("id", data.id);
    return bench;
  });
