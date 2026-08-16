/** Module Magasin : retours pièces, avoirs, relances. */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type PartReturn = Database["public"]["Tables"]["part_returns"]["Row"];
export type ReturnLine = Database["public"]["Tables"]["part_return_lines"]["Row"];
export type CreditNote = Database["public"]["Tables"]["credit_notes"]["Row"];
export type CreditNoteLine = Database["public"]["Tables"]["credit_note_lines"]["Row"];

export const RETURN_STATUSES = [
  { key: "brouillon", label: "Brouillon", tone: "bg-zinc-200 text-zinc-700" },
  { key: "demande_creee", label: "Demande créée", tone: "bg-secondary text-foreground" },
  { key: "a_preparer", label: "À préparer magasin", tone: "bg-amber-200 text-amber-950" },
  { key: "prepare", label: "Retour préparé", tone: "bg-blue-100 text-blue-900" },
  { key: "expedie", label: "Expédié", tone: "bg-blue-200 text-blue-950" },
  { key: "avoir_attendu", label: "Avoir attendu", tone: "bg-amber-200 text-amber-950" },
  { key: "partiellement_avoire", label: "Partiellement avoiré", tone: "bg-orange-200 text-orange-950" },
  { key: "totalement_avoire", label: "Totalement avoiré", tone: "bg-emerald-200 text-emerald-950" },
  { key: "cloture", label: "Clôturé", tone: "bg-zinc-800 text-zinc-100" },
  { key: "blocage_fournisseur", label: "Blocage fournisseur", tone: "bg-red-200 text-red-950" },
  { key: "refus", label: "Refus", tone: "bg-red-200 text-red-950" },
  { key: "litige", label: "Litige", tone: "bg-red-300 text-red-950" },
  { key: "annule", label: "Annulé", tone: "bg-zinc-200 text-zinc-700" },
] as const;

export function returnStatusLabel(k: string) {
  return RETURN_STATUSES.find((s) => s.key === k)?.label ?? k;
}
export function returnStatusTone(k: string) {
  return RETURN_STATUSES.find((s) => s.key === k)?.tone ?? "bg-secondary text-foreground";
}

export function ageBucket(iso: string): "0-15" | "16-30" | "31-45" | "45+" {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 15) return "0-15";
  if (days <= 30) return "16-30";
  if (days <= 45) return "31-45";
  return "45+";
}

export function deadlineFrom(maxDays: number | null | undefined): string | null {
  if (!maxDays) return null;
  const d = new Date();
  d.setDate(d.getDate() + maxDays);
  return d.toISOString().slice(0, 10);
}

export function isUrgent(r: PartReturn): boolean {
  if (!r.deadline_date) return false;
  if (["totalement_avoire", "cloture", "annule"].includes(r.status)) return false;
  const days = (new Date(r.deadline_date).getTime() - Date.now()) / 86400000;
  return days <= 7;
}

export async function listReturns(): Promise<(PartReturn & { lines: ReturnLine[] })[]> {
  const { data, error } = await supabase
    .from("part_returns")
    .select("*, lines:part_return_lines(*)")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as (PartReturn & { lines: ReturnLine[] })[];
}

export function isDraft(r: Pick<PartReturn, "status">): boolean {
  return r.status === "brouillon";
}

export async function getReturn(id: string) {
  const { data } = await supabase
    .from("part_returns")
    .select("*, lines:part_return_lines(*)")
    .eq("id", id)
    .maybeSingle();
  return (data as (PartReturn & { lines: ReturnLine[] })) ?? null;
}

/** Recalcule le statut d'avoir d'un retour à partir de ses lignes. */
export async function refreshReturnCredit(id: string) {
  const r = await getReturn(id);
  if (!r) return;
  const totalQty = r.lines.reduce((s, l) => s + Number(l.quantity ?? 0), 0);
  const creditedQty = r.lines.reduce((s, l) => s + Number(l.credited_quantity ?? 0), 0);
  const creditedAmount = r.lines.reduce((s, l) => s + Number(l.credited_amount ?? 0), 0);
  let status = r.status;
  if (creditedQty <= 0) status = r.status === "expedie" ? "avoir_attendu" : r.status;
  else if (creditedQty < totalQty) status = "partiellement_avoire";
  else status = "totalement_avoire";
  await supabase.from("part_returns").update({ status, credited_amount: creditedAmount }).eq("id", id);
}

export type ReturnCounters = {
  a_preparer: number;
  prepares: number;
  a_expedier: number;
  urgences: number;
  avoirs_attendus: number;
  avoirs_partiels: number;
  consignes: number;
  litiges: number;
  clotures: number;
  montant_attendu: number;
};

export function computeReturnCounters(rows: (PartReturn & { lines: ReturnLine[] })[]): ReturnCounters {
  const open = rows.filter((r) => !["cloture", "annule"].includes(r.status));
  const expected = open
    .filter((r) => ["expedie", "avoir_attendu", "partiellement_avoire"].includes(r.status))
    .reduce((s, r) => s + Math.max(0, Number(r.expected_amount ?? 0) - Number(r.credited_amount ?? 0)), 0);
  return {
    a_preparer: open.filter((r) => r.status === "demande_creee" || r.status === "a_preparer").length,
    prepares: open.filter((r) => r.status === "prepare").length,
    a_expedier: open.filter((r) => r.status === "prepare").length,
    urgences: open.filter(isUrgent).length,
    avoirs_attendus: open.filter((r) => r.status === "avoir_attendu" || r.status === "expedie").length,
    avoirs_partiels: open.filter((r) => r.status === "partiellement_avoire").length,
    consignes: open.filter((r) => r.lines.some((l) => l.item_type === "consigne")).length,
    litiges: open.filter((r) => ["litige", "refus", "blocage_fournisseur"].includes(r.status)).length,
    clotures: rows.filter((r) => r.status === "cloture").length,
    montant_attendu: Math.round(expected * 100) / 100,
  };
}
