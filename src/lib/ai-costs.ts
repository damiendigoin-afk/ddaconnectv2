/** Lecture du journal des coûts IA et des budgets (manager). */
import { supabase } from "@/integrations/supabase/client";

export type AiUsageRow = {
  id: string;
  created_at: string;
  feature: string;
  model: string | null;
  entity: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  duration_ms: number | null;
  http_status: number | null;
  success: boolean;
  cache_hit: boolean;
  blocked_reason: string | null;
  estimated_credits: number;
};

export type AiBudget = {
  id: string;
  daily_credits: number;
  monthly_credits: number;
  max_credits_per_operation: number;
  fallback_ai_enabled: boolean;
};

export type AiCostSummary = {
  rows: AiUsageRow[];
  today: number;
  month: number;
  callsToday: number;
  cacheHitsToday: number;
  blockedToday: number;
  failedBilledToday: number;
  byFeature: { feature: string; calls: number; credits: number; cacheHits: number }[];
};

function startOfDay(): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())).toISOString();
}
function startOfMonth(): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)).toISOString();
}

export function summarize(rows: AiUsageRow[]): AiCostSummary {
  const day = startOfDay();
  const month = startOfMonth();
  const inDay = rows.filter((r) => r.created_at >= day);
  const inMonth = rows.filter((r) => r.created_at >= month);
  const map = new Map<string, { feature: string; calls: number; credits: number; cacheHits: number }>();
  for (const r of inMonth) {
    const e = map.get(r.feature) ?? { feature: r.feature, calls: 0, credits: 0, cacheHits: 0 };
    e.calls += 1;
    e.credits += Number(r.estimated_credits ?? 0);
    if (r.cache_hit) e.cacheHits += 1;
    map.set(r.feature, e);
  }
  return {
    rows,
    today: inDay.reduce((s, r) => s + Number(r.estimated_credits ?? 0), 0),
    month: inMonth.reduce((s, r) => s + Number(r.estimated_credits ?? 0), 0),
    callsToday: inDay.filter((r) => !r.cache_hit).length,
    cacheHitsToday: inDay.filter((r) => r.cache_hit).length,
    blockedToday: inDay.filter((r) => r.blocked_reason).length,
    failedBilledToday: inDay.filter((r) => !r.success && Number(r.estimated_credits ?? 0) > 0).length,
    byFeature: [...map.values()].sort((a, b) => b.credits - a.credits),
  };
}

export async function fetchAiCosts(): Promise<AiCostSummary> {
  const { data } = await supabase
    .from("ai_usage_log")
    .select(
      "id, created_at, feature, model, entity, tokens_in, tokens_out, duration_ms, http_status, success, cache_hit, blocked_reason, estimated_credits",
    )
    .gte("created_at", startOfMonth())
    .order("created_at", { ascending: false })
    .limit(500);
  return summarize((data ?? []) as AiUsageRow[]);
}

export async function fetchAiBudget(): Promise<AiBudget | null> {
  const { data } = await supabase.from("ai_budget_settings").select("*").limit(1).maybeSingle();
  return (data as AiBudget | null) ?? null;
}

export async function saveAiBudget(b: AiBudget) {
  const { error } = await supabase
    .from("ai_budget_settings")
    .update({
      daily_credits: Number(b.daily_credits),
      monthly_credits: Number(b.monthly_credits),
      max_credits_per_operation: Number(b.max_credits_per_operation),
      fallback_ai_enabled: b.fallback_ai_enabled === true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", b.id);

  if (error) throw error;
}

/** Palier d'alerte 50 / 75 / 90 / 100 %. */
export function alertLevel(used: number, limit: number): 0 | 50 | 75 | 90 | 100 {
  if (limit <= 0) return 0;
  const pct = (used / limit) * 100;
  if (pct >= 100) return 100;
  if (pct >= 90) return 90;
  if (pct >= 75) return 75;
  if (pct >= 50) return 50;
  return 0;
}
