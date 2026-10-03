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
import { budgetStatus, parisDayStartIso, parisMonthStartIso, type BudgetStatus } from "./ai-budget-day";

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
  /** Voie du pipeline documentaire (ai_text_fallback | ai_vision_fallback). */
  route?: "ai_text_fallback" | "ai_vision_fallback";
  /**
   * Vision indispensable sur une vraie photo / un PDF scanné dont la qualité métier OCR est
   * insuffisante : autorisée même si le réglage « repli IA » est désactivé (budgets toujours appliqués).
   */
  essentialVision?: boolean;
  /** Banc de test : ni lecture ni écriture du cache (nouvelle analyse réelle). */
  bypassCache?: boolean;
  /**
   * Banc de test : budgets prod et réglage « repli IA » ignorés — l'appelant applique
   * le budget benchmark séparé. Ne JAMAIS utiliser pour un flux métier.
   */
  benchmark?: boolean;
};

export type PaidAiMetrics = { tokensIn: number; tokensOut: number; durationMs: number; httpStatus: number | null };

export type PaidAiResult =
  | ({ ok: true; content: string; cached: boolean; credits: number } & PaidAiMetrics)
  | ({ ok: false; error: string; status?: number; blocked?: boolean } & Partial<PaidAiMetrics>);

/** Préfixe des fonctions du banc de test : exclues du budget prod, budget séparé. */
export const BENCH_FEATURE = "ai_document_benchmark";

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

/**
 * Crédits consommés depuis `iso`. "all" = budget journalier UNIQUE partagé (prod + banc + étape pneu) ;
 * "prod"/"benchmark" restent disponibles pour l'affichage détaillé.
 */
export async function spentSince(iso: string, scope: "all" | "prod" | "benchmark" = "all"): Promise<number> {
  const q = supabaseAdmin.from("ai_usage_log").select("estimated_credits").gte("created_at", iso);
  const { data } = await (scope === "all" ? q : scope === "prod" ? q.not("feature", "like", `${BENCH_FEATURE}%`) : q.like("feature", `${BENCH_FEATURE}%`));
  return (data ?? []).reduce((s, r) => s + Number(r.estimated_credits ?? 0), 0);
}

/** Budget journalier configuré dans « Coûts et IA », consommé aujourd'hui (jour de Paris), restant. */
export async function dailyBudgetStatus(): Promise<BudgetStatus> {
  const [b, spent] = await Promise.all([readBudget(), spentSince(parisDayStartIso(), "all")]);
  return budgetStatus(b.daily, spent);
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
  route?: string | null;
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
      route: row.route ?? null,
    });
  } catch (e) {
    console.error("ai_usage_log insert failed", e);
  }
}

/** Journal d'une lecture SANS IA (OCR/règles) : 0 crédit, jamais comptée comme consommation IA. */
export async function journalLocal(row: { feature: string; fingerprint: string; route: "ocr_rules" | "manual"; success: boolean; blocked_reason?: string | null }) {
  await journal({ feature: row.feature, fingerprint: row.fingerprint, model: "local-ocr", success: row.success, blocked_reason: row.blocked_reason ?? null, calls: 0, estimated_credits: 0, route: row.route });
}

/* ------------------------------ Appel payant ------------------------------ */

export async function runPaidAi(input: PaidAiInput): Promise<PaidAiResult> {
  const fp = await fingerprint(input.feature, input.model, input.fingerprintSeed);

  // 1. Cache : un média inchangé n'est jamais réanalysé (sauf banc de test en mode bypass).
  if (!input.bypassCache) try {
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
        route: "cache",
        success: true,
        cache_hit: true,
        estimated_credits: 0,
      });
      return { ok: true, content: cached.content, cached: true, credits: 0, tokensIn: 0, tokensOut: 0, durationMs: 0, httpStatus: null };
    }
  } catch (e) {
    console.error("ai_cache read failed", e);
  }

  // 2. Budgets.
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return { ok: false, error: MANUAL_FALLBACK_MESSAGE };

  if (!input.benchmark) {
  const budget = await readBudget();
  // Règle DDA : toute IA est un repli ultime ; réglage « repli IA » désactivé => aucun appel.
  if (!budget.fallbackAiEnabled && !input.essentialVision) {
    await journal({ feature: input.feature, fingerprint: fp, model: input.model, user_id: input.userId, site_id: input.siteId, entity: input.entity, success: false, blocked_reason: "repli_ia_desactive", calls: 0, estimated_credits: 0, route: input.route ?? "ai_vision_fallback" });
    return { ok: false, error: MANUAL_FALLBACK_MESSAGE, blocked: true };
  }
  const [day, month] = await Promise.all([spentSince(parisDayStartIso(), "all"), spentSince(parisMonthStartIso(), "all")]);

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
      route: input.route ?? "ai_vision_fallback",
      success: false,
      blocked_reason: blocked,
      estimated_credits: 0,
    });
    return { ok: false, error: MANUAL_FALLBACK_MESSAGE, blocked: true };
  }
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
      route: input.route ?? "ai_vision_fallback",
      success: false,
      duration_ms: Date.now() - started,
      estimated_credits: 0,
    });
    return { ok: false, error: MANUAL_FALLBACK_MESSAGE, durationMs: Date.now() - started, httpStatus: null };
  }

  if (!res.ok) {
    const detail = await res.text();
    const durationMs = Date.now() - started;
    console.error("ai gateway error", res.status, detail.slice(0, 500));
    await journal({
      feature: input.feature,
      fingerprint: fp,
      model: input.model,
      user_id: input.userId,
      site_id: input.siteId,
      entity: input.entity,
      route: input.route ?? "ai_vision_fallback",
      success: false,
      duration_ms: durationMs,
      http_status: res.status,
      blocked_reason: res.status === 402 ? "credits_epuises" : res.status === 429 ? "rate_limit" : null,
      estimated_credits: 0,
    });
    const m = { durationMs, httpStatus: res.status };
    // 402 / 429 / 403 : terminal, aucun retry côté application.
    if (res.status === 402) return { ok: false, error: "Crédits d'analyse épuisés. " + MANUAL_FALLBACK_MESSAGE, status: 402, blocked: true, ...m };
    if (res.status === 429) return { ok: false, error: "Trop de demandes. " + MANUAL_FALLBACK_MESSAGE, status: 429, blocked: true, ...m };
    if (res.status === 403) return { ok: false, error: MANUAL_FALLBACK_MESSAGE, status: 403, blocked: true, ...m };
    return { ok: false, error: MANUAL_FALLBACK_MESSAGE, status: res.status, ...m };
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const durationMs = Date.now() - started;
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
    duration_ms: durationMs,
    http_status: 200,
    success: Boolean(content),
    estimated_credits: credits,
  });

  if (content && !input.bypassCache) {
    try {
      await supabaseAdmin
        .from("ai_cache")
        .upsert({ fingerprint: fp, feature: input.feature, model: input.model, content }, { onConflict: "fingerprint" });
    } catch (e) {
      console.error("ai_cache write failed", e);
    }
  }

  return { ok: true, content, cached: false, credits, tokensIn, tokensOut, durationMs, httpStatus: 200 };
}
