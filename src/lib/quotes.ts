/**
 * Devis centralisés : persistance des chiffrages produits par le moteur central.
 * Chaque devis fige l'instantané des taux et règles utilisés : les historiques
 * ne sont jamais recalculés rétroactivement.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  engineSnapshot,
  type EngineContext,
  type PricedItem,
  type Priority,
  type QuoteBlock,
} from "./pricing-engine";

export type Quote = Database["public"]["Tables"]["pricing_quotes"]["Row"];
export type QuoteLine = Database["public"]["Tables"]["pricing_quote_lines"]["Row"];

export type ClientResponse = "pending" | "accepted" | "refused" | "later" | "contact";

export const RESPONSE_LABEL: Record<ClientResponse, string> = {
  pending: "En attente",
  accepted: "J'accepte",
  refused: "Je refuse",
  later: "Plus tard",
  contact: "Je souhaite être contacté",
};

/** Une ligne sans prix exploitable reste enregistrable, marquée « à compléter ». */
export function isIncompleteLine(item: Pick<PricedItem, "needsContact" | "totalTtc">) {
  return item.needsContact || !(item.totalTtc > 0);
}

export function lineFromItem(item: PricedItem, index = 0) {
  const incomplete = isIncompleteLine(item);
  return {
    block: item.block,
    label: item.label,
    detail: item.detail || (item.needsContact ? item.message : null),
    priority: item.priority,
    price_source: item.source,
    confidence: item.confidence,
    needs_contact: item.needsContact,
    quantity: Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1,
    hours: item.hours,
    unit_ht: Number.isFinite(item.unitHt as number) ? item.unitHt : null,
    total_ht: Number.isFinite(item.totalHt) ? Math.round(item.totalHt * 100) / 100 : 0,
    total_ttc: Number.isFinite(item.totalTtc) ? Math.round(item.totalTtc * 100) / 100 : 0,
    origin_point_key: item.originPointKey ?? null,
    computation: { ...(item.computation ?? {}), a_completer: incomplete } as never,
    sort_order: index,
  };
}

export async function createQuote(args: {
  ctx: EngineContext;
  items: PricedItem[];
  sourceModule: string;
  sourceId?: string | null;
  repairOrderId?: string | null;
  refVehicleId?: string | null;
  plate?: string | null;
  siteId?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
}): Promise<Quote> {
  const totalHt = args.items.reduce((s, i) => s + (Number.isFinite(i.totalHt) ? i.totalHt : 0), 0);
  const totalTtc = args.items.reduce((s, i) => s + (Number.isFinite(i.totalTtc) ? i.totalTtc : 0), 0);
  const { data, error } = await supabase
    .from("pricing_quotes")
    .insert({
      source_module: args.sourceModule,
      source_id: args.sourceId ?? null,
      repair_order_id: args.repairOrderId ?? null,
      ref_vehicle_id: args.refVehicleId ?? null,
      plate: args.plate ?? null,
      site_id: args.siteId ?? null,
      created_by: args.createdBy ?? null,
      created_by_name: args.createdByName ?? null,
      rates_snapshot: engineSnapshot(args.ctx) as never,
      total_ht: Math.round(totalHt * 100) / 100,
      total_ttc: Math.round(totalTtc * 100) / 100,
    })
    .select("*")
    .single();
  if (error) throw error;
  if (args.items.length) {
    const { error: e2 } = await supabase
      .from("pricing_quote_lines")
      .insert(args.items.map((it, i) => ({ quote_id: data.id, ...lineFromItem(it, i) })));
    if (e2) throw e2;
  }
  return data as Quote;
}

export async function addLine(quoteId: string, item: PricedItem, index = 0) {
  const { error } = await supabase
    .from("pricing_quote_lines")
    .insert({ quote_id: quoteId, ...lineFromItem(item, index) });
  if (error) throw error;
  await refreshTotals(quoteId);
}

export async function updateLine(
  id: string,
  patch: Partial<{
    label: string;
    detail: string | null;
    priority: Priority;
    block: QuoteBlock;
    quantity: number;
    hours: number | null;
    unit_ht: number | null;
    total_ht: number;
    total_ttc: number;
    price_source: string;
    confidence: string;
    needs_contact: boolean;
  }>,
) {
  const { data, error } = await supabase
    .from("pricing_quote_lines")
    .update(patch as never)
    .eq("id", id)
    .select("quote_id")
    .single();
  if (error) throw error;
  await refreshTotals(data.quote_id);
}

export async function removeLine(id: string) {
  const { data, error } = await supabase
    .from("pricing_quote_lines")
    .delete()
    .eq("id", id)
    .select("quote_id")
    .single();
  if (error) throw error;
  await refreshTotals(data.quote_id);
}

export async function fetchQuote(id: string): Promise<{ quote: Quote; lines: QuoteLine[] }> {
  const [q, l] = await Promise.all([
    supabase.from("pricing_quotes").select("*").eq("id", id).single(),
    supabase.from("pricing_quote_lines").select("*").eq("quote_id", id).order("sort_order"),
  ]);
  if (q.error) throw q.error;
  if (l.error) throw l.error;
  return { quote: q.data as Quote, lines: (l.data ?? []) as QuoteLine[] };
}

export async function fetchQuoteForSource(
  sourceModule: string,
  sourceId: string,
): Promise<{ quote: Quote; lines: QuoteLine[] } | null> {
  const { data, error } = await supabase
    .from("pricing_quotes")
    .select("*")
    .eq("source_module", sourceModule)
    .eq("source_id", sourceId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const quote = (data ?? [])[0] as Quote | undefined;
  if (!quote) return null;
  return fetchQuote(quote.id);
}

/** Les sous-totaux se recalculent sur les lignes non refusées. */
export function quoteTotals(lines: QuoteLine[], onlyAccepted = false) {
  const kept = lines.filter((l) =>
    onlyAccepted ? l.client_response === "accepted" : l.client_response !== "refused",
  );
  const blocks: Record<QuoteBlock, { lines: QuoteLine[]; ht: number; ttc: number }> = {
    mecanique: { lines: [], ht: 0, ttc: 0 },
    carrosserie: { lines: [], ht: 0, ttc: 0 },
    esthetique: { lines: [], ht: 0, ttc: 0 },
  };
  for (const l of lines) {
    const b = blocks[(l.block as QuoteBlock) ?? "mecanique"] ?? blocks.mecanique;
    b.lines.push(l);
    if (kept.includes(l)) {
      b.ht = Math.round((b.ht + Number(l.total_ht)) * 100) / 100;
      b.ttc = Math.round((b.ttc + Number(l.total_ttc)) * 100) / 100;
    }
  }
  return {
    blocks,
    totalHt: Math.round(kept.reduce((s, l) => s + Number(l.total_ht), 0) * 100) / 100,
    totalTtc: Math.round(kept.reduce((s, l) => s + Number(l.total_ttc), 0) * 100) / 100,
    pendingContact: lines.filter((l) => l.needs_contact).length,
  };
}

async function refreshTotals(quoteId: string) {
  const { data } = await supabase
    .from("pricing_quote_lines")
    .select("total_ht,total_ttc,client_response")
    .eq("quote_id", quoteId);
  const kept = (data ?? []).filter((l) => l.client_response !== "refused");
  await supabase
    .from("pricing_quotes")
    .update({
      total_ht: Math.round(kept.reduce((s, l) => s + Number(l.total_ht), 0) * 100) / 100,
      total_ttc: Math.round(kept.reduce((s, l) => s + Number(l.total_ttc), 0) * 100) / 100,
    })
    .eq("id", quoteId);
}

/* ------------------------- Traçabilité IA / apprentissage ----------------- */

export async function logAiCorrection(args: {
  module: string;
  subject: string;
  context?: string | null;
  refVehicleId?: string | null;
  plate?: string | null;
  sourceId?: string | null;
  mediaId?: string | null;
  aiResult?: unknown;
  aiConfidence?: string | null;
  humanResult?: unknown;
  finalResult?: unknown;
  corrected: boolean;
  userId?: string | null;
  userName?: string | null;
}) {
  const { error } = await supabase.from("ai_corrections").insert({
    module: args.module,
    subject: args.subject,
    context: args.context ?? null,
    ref_vehicle_id: args.refVehicleId ?? null,
    plate: args.plate ?? null,
    source_id: args.sourceId ?? null,
    media_id: args.mediaId ?? null,
    ai_result: (args.aiResult ?? null) as never,
    ai_confidence: args.aiConfidence ?? null,
    human_result: (args.humanResult ?? null) as never,
    final_result: (args.finalResult ?? null) as never,
    corrected: args.corrected,
    user_id: args.userId ?? null,
    user_name: args.userName ?? null,
  });
  if (error) throw error;
}
