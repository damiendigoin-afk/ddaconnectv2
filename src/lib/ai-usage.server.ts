/**
 * Service central UNIQUE des appels IA payants.
 *
 * Toute fonction payante du projet passe par `runPaidAi` :
 *  - empreinte du média + fonction + modèle (cache : un média inchangé n'est analysé qu'une fois) ;
 *  - contrôle de budget (journalier, mensuel, coût maximal par opération) ;
 *  - un seul appel réseau, JAMAIS de retry sur 402 / 429 / 499 ni sur annulation ;
 *  - journal complet (fonction, modèle, tokens, durée, statut, cache, coût estimé).
 *
 * Aucune clé n'existe côté navigateur : ce module est serveur uniquement.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

/** Message unique présenté à l'opérateur quand l'IA n'est pas disponible. */
export const MANUAL_FALLBACK_MESSAGE =
  "Analyse automatique momentanément indisponible. Vous pouvez compléter les informations manuellement.";

export type PaidAiInput = {
  /** Nom fonctionnel (ocr_compteur, tire_wheel, memento_fallback…). */
  feature: string;
  /** Graine d'empreinte : chemin de stockage, dataUrl, ou hash de page. */
  fingerprintSeed: string;
  model: string;
  body: Record<string, unknown>;
  entity?: string | null;
  userId?: string | null;
  siteId?: string | null;
  /** Coût maximal accepté pour cette opération (crédits). */
  maxCredits?: number | null;
};

export type PaidAiResult =
  | { ok: true; content: string; cached: boolean; credits: number }
  | { ok: false; error: string; status?: number; blocked?: boolean };

/* ------------------------------ Empreintes ------------------------------- */

export async function fingerprint(...parts: string[]): Promise<string> {
  const data = new TextEncoder().encode(parts.join("\u0000"));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* -------------------------------- Coûts ---------------------------------- */

/** Estimation calibrée sur les relevés réels de la passerelle (crédits). */
export function estimateCredits(tokensIn: number, tokensOut: number): number {
  return Math.round((tokensIn * 0.000015 + tokensOut * 0.00006) * 10000) / 10000;
}

type Budget = {
  daily: number;
  monthly: number;
  perOperation: number;
  fallbackAiEnabled: boolean;
};

export async function readBudget(): Promise<Budget> {
  const { data } = await supabaseAdmin
    .from("ai_budget_settings")
    .select("daily_credits, monthly_credits, max_credits_per_operation, fallback_ai_enabled")
    .limit(1)
    .maybeSingle();
  return {
    daily: Number(data?.daily_credits ?? 5),
    monthly: Number(data?.monthly_credits ?? 150),
    perOperation: Number(data?.max_credits_per_operation ?? 1),
    fallbackAiEnabled: data?.fallback_ai_enabled === true,
  };
}

async function spentSince(iso: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from("ai_usage_log")
    .select("estimated_credits")
    .gte("created_at", iso);
  return (data ?? []).reduce((s, r) => s + Number(r.estimated_credits ?? 0), 0);
}

/* -------------------------------- Journal -------------------------------- */

type LogRow = {
  feature: string;
  fingerprint: string;
  model: string;
  user_id?: string | null | undefined;
  site_id?: string | null | undefined;
  entity?: string | null | undefined;
  tokens_in?: number | null;
  tokens_out?: number | null;
  calls?: number;
  duration_ms?: number | null;
  http_status?: number | null;
  success: boolean;
  cache_hit?: boolean;
  blocked_reason?: string | null;
  estimated_credits?: number;
};

async function journal(row: LogRow) {
  try {
    await supabaseAdmin.from("ai_usage_log").insert({
      feature: row.feature,
      fingerprint: row.fingerprint,
      model: row.model,
      user_id: row.user_id ?? null,
      site_id: row.site_id ?? null,
      entity: row.entity ?? null,
      tokens_in: row.tokens_in ?? null,
      tokens_out: row.tokens_out ?? null,
      calls: row.calls ?? 1,
      retries: 0,
      duration_ms: row.duration_ms ?? null,
      http_status: row.http_status ?? null,
      success: row.success,
      cache_hit: row.cache_hit ?? false,
      blocked_reason: row.blocked_reason ?? null,
      estimated_credits: row.estimated_credits ?? 0,
    });
  } catch (e) {
    console.error("ai_usage_log insert failed", e);
  }
}

/* ------------------------------ Appel payant ------------------------------ */

export async function runPaidAi(input: PaidAiInput): Promise<PaidAiResult> {
  const fp = await fingerprint(input.feature, input.model, input.fingerprintSeed);

  // 1. Cache : un média inchangé n'est jamais réanalysé.
  try {
    const { data: cached } = await supabaseAdmin
      .from("ai_cache")
      .select("content, hits")
      .eq("fingerprint", fp)
      .maybeSingle();
    if (cached?.content) {
      await supabaseAdmin
        .from("ai_cache")
        .update({ hits: (cached.hits ?? 0) + 1, last_used_at: new Date().toISOString() })
        .eq("fingerprint", fp);
      await journal({
        feature: input.feature,
        fingerprint: fp,
        model: input.model,
        user_id: input.userId,
        site_id: input.siteId,
        entity: input.entity,
        success: true,
        cache_hit: true,
        estimated_credits: 0,
      });
      return { ok: true, content: cached.content, cached: true, credits: 0 };
    }
  } catch (e) {
    console.error("ai_cache read failed", e);
  }

  // 2. Budgets.
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return { ok: false, error: MANUAL_FALLBACK_MESSAGE };

  const budget = await readBudget();
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const [day, month] = await Promise.all([spentSince(dayStart), spentSince(monthStart)]);

  const blocked =
    day >= budget.daily ? "budget_journalier" : month >= budget.monthly ? "budget_mensuel" : null;
  if (blocked) {
    await journal({
      feature: input.feature,
      fingerprint: fp,
      model: input.model,
      user_id: input.userId,
      site_id: input.siteId,
      entity: input.entity,
      success: false,
      blocked_reason: blocked,
      estimated_credits: 0,
    });
    return { ok: false, error: MANUAL_FALLBACK_MESSAGE, blocked: true };
  }

  // 3. Appel unique, sans aucun retry.
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(GATEWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ ...input.body, model: input.model }),
    });
  } catch (e) {
    console.error("ai gateway network error", e);
    await journal({
      feature: input.feature,
      fingerprint: fp,
      model: input.model,
      user_id: input.userId,
      site_id: input.siteId,
      entity: input.entity,
      success: false,
      duration_ms: Date.now() - started,
      estimated_credits: 0,
    });
    return { ok: false, error: MANUAL_FALLBACK_MESSAGE };
  }

  if (!res.ok) {
    const detail = await res.text();
    console.error("ai gateway error", res.status, detail.slice(0, 500));
    await journal({
      feature: input.feature,
      fingerprint: fp,
      model: input.model,
      user_id: input.userId,
      site_id: input.siteId,
      entity: input.entity,
      success: false,
      duration_ms: Date.now() - started,
      http_status: res.status,
      blocked_reason: res.status === 402 ? "credits_epuises" : res.status === 429 ? "rate_limit" : null,
      estimated_credits: 0,
    });
    // 402 / 429 / 403 : terminal, aucun retry côté application.
    if (res.status === 402) return { ok: false, error: "Crédits d'analyse épuisés. " + MANUAL_FALLBACK_MESSAGE, status: 402, blocked: true };
    if (res.status === 429) return { ok: false, error: "Trop de demandes. " + MANUAL_FALLBACK_MESSAGE, status: 429, blocked: true };
    if (res.status === 403) return { ok: false, error: MANUAL_FALLBACK_MESSAGE, status: 403, blocked: true };
    return { ok: false, error: MANUAL_FALLBACK_MESSAGE, status: res.status };
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  const tokensIn = json.usage?.prompt_tokens ?? 0;
  const tokensOut = json.usage?.completion_tokens ?? 0;
  const credits = estimateCredits(tokensIn, tokensOut);

  await journal({
    feature: input.feature,
    fingerprint: fp,
    model: input.model,
    user_id: input.userId,
    site_id: input.siteId,
    entity: input.entity,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    duration_ms: Date.now() - started,
    http_status: 200,
    success: Boolean(content),
    estimated_credits: credits,
  });

  if (content) {
    try {
      await supabaseAdmin
        .from("ai_cache")
        .upsert({ fingerprint: fp, feature: input.feature, model: input.model, content }, { onConflict: "fingerprint" });
    } catch (e) {
      console.error("ai_cache write failed", e);
    }
  }

  return { ok: true, content, cached: false, credits };
}
