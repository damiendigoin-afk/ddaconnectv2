import { supabase } from "@/integrations/supabase/client";

export type ExpenseNote = {
  id: string;
  user_id: string;
  user_name: string | null;
  site_id: string | null;
  spent_on: string;
  category: string;
  purpose: string | null;
  merchant: string | null;
  amount_ttc: number;
  vat_amount: number | null;
  vat_rate: number | null;
  payment_method: string;
  receipt_path: string | null;
  receipt_mime: string | null;
  status: string;
  reject_reason: string | null;
  notes: string | null;
  created_at: string;
  validated_by_name: string | null;
  validated_at: string | null;
  accounting_email: string | null;
  sent_at: string | null;
  send_status: string | null;
  send_error: string | null;
  settled_at: string | null;
  settled_by_name: string | null;
  accounted_at: string | null;
  accounted_by_name: string | null;
  validated_pdf_path: string | null;
  employee_notified_at: string | null;
  archived_at: string | null;
  archived_by_name: string | null;
  account_ref: string | null;
  account_other: string | null;
  reconciled_at: string | null;
  reconciled_by_name: string | null;
};

const COLUMNS =
  "id, user_id, user_name, site_id, spent_on, category, purpose, merchant, amount_ttc, vat_amount, vat_rate, payment_method, receipt_path, receipt_mime, status, reject_reason, notes, created_at, validated_by_name, validated_at, accounting_email, sent_at, send_status, send_error, settled_at, settled_by_name, accounted_at, accounted_by_name, validated_pdf_path, employee_notified_at, archived_at, archived_by_name, account_ref, account_other, reconciled_at, reconciled_by_name";


/** Motifs proposés par l'analyse du justificatif, toujours modifiables. */
export const EXPENSE_CATEGORIES = [
  { key: "restaurant", label: "Restaurant" },
  { key: "carburant", label: "Essence / Carburant" },
  { key: "peage", label: "Péage" },
  { key: "parking", label: "Parking" },
  { key: "hotel", label: "Hôtel" },
  { key: "fournitures", label: "Fournitures" },
  { key: "achat_divers", label: "Achat divers" },
  { key: "autre", label: "Autre" },
] as const;

export const PAYMENT_METHODS = [
  { key: "perso", label: "Perso à rembourser", pro: false },
  { key: "pro_cb", label: "Pro — CB", pro: true },
  { key: "pro_especes", label: "Pro — Espèces", pro: true },
  { key: "pro_cheque", label: "Pro — Chèque", pro: true },
  { key: "pro_virement", label: "Pro — Virement", pro: true },
  { key: "en_compte", label: "En compte", pro: true },
] as const;

/**
 * Référentiel simple des cartes / comptes utilisables avec « En compte ».
 * Extensible : le champ « Autre » reste toujours saisissable librement.
 */
export const EXPENSE_ACCOUNTS = [
  { key: "carrefour_atelier", label: "Carrefour — Atelier" },
  { key: "carrefour_vo", label: "Carrefour — VO" },
  { key: "carrefour_direction", label: "Carrefour — Direction" },
  { key: "intermarche_lalinde", label: "Intermarché — Lalinde" },
  { key: "bricorama", label: "Bricorama" },
  { key: "carrefour_fournisseur", label: "Carrefour — Compte fournisseur" },
  { key: "autre", label: "Autre" },
] as const;

export function isAccountPayment(method: string | null | undefined): boolean {
  return method === "en_compte";
}

export function accountLabel(ref: string | null | undefined, other?: string | null): string {
  if (!ref) return other?.trim() || "—";
  if (ref === "autre") return other?.trim() || "Autre";
  return EXPENSE_ACCOUNTS.find((a) => a.key === ref)?.label ?? other?.trim() ?? ref;
}


export const EXPENSE_STATUS = [
  { key: "brouillon", label: "Brouillon" },
  { key: "soumis", label: "À valider" },
  { key: "valide", label: "Validée" },
  { key: "transmise", label: "Transmise compta" },
  { key: "reglee", label: "Remboursement réglé" },
  { key: "comptabilisee", label: "Comptabilisée" },
  { key: "refuse", label: "Refusée / à corriger" },
] as const;

/** Boîtes comptables par établissement (codes réels en base : dda, castillon). */
export const ACCOUNTING_EMAILS: Record<string, string> = {
  dda: "compta@dda-lalinde.fr",
  lalinde: "compta@dda-lalinde.fr",
  castillon: "compta@garagecastillon.fr",
  st_cyprien: "compta@garagecastillon.fr",
};

/**
 * Routage comptable robuste : on s'appuie d'abord sur le code réel du site,
 * puis, si un site est renommé/recodé, sur son libellé. Aucun doublon d'adresse.
 */
export function accountingEmailFor(code: string | null | undefined, name?: string | null): string {
  const key = (code ?? "").trim().toLowerCase();
  if (ACCOUNTING_EMAILS[key]) return ACCOUNTING_EMAILS[key]!;
  const label = `${code ?? ""} ${name ?? ""}`.toLowerCase();
  if (/(castillon|cyprien)/.test(label)) return "compta@garagecastillon.fr";
  if (/(lalinde|digoin|\bdda\b)/.test(label)) return "compta@dda-lalinde.fr";
  return "";
}

export function isPersonalPayment(method: string | null | undefined): boolean {
  return (method ?? "perso") === "perso";
}

export function paymentLabel(method: string | null | undefined): string {
  return PAYMENT_METHODS.find((p) => p.key === (method ?? "perso"))?.label ?? "—";
}

export function categoryLabel(key: string | null | undefined): string {
  return EXPENSE_CATEGORIES.find((c) => c.key === key)?.label ?? (key ?? "—");
}

export function statusLabel(key: string | null | undefined): string {
  return EXPENSE_STATUS.find((s) => s.key === key)?.label ?? (key ?? "—");
}

export function statusTone(status: string) {
  if (status === "reglee" || status === "comptabilisee") return "bg-status-ok-soft text-status-ok";
  if (status === "refuse") return "bg-status-watch-soft text-status-watch";
  if (status === "valide" || status === "transmise") return "bg-brand/10 text-brand";
  if (status === "soumis") return "bg-secondary text-foreground";
  return "bg-secondary text-muted-foreground";
}

export function euros(v: number | null | undefined): string {
  return Number(v ?? 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

export function frDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("fr-FR");
}

export function frDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export type ExpenseScope = "mine" | "to_validate" | "accounting" | "all";

export async function listExpenses(scope: ExpenseScope, userId: string | null): Promise<ExpenseNote[]> {
  let q = supabase.from("expense_notes").select(COLUMNS).order("created_at", { ascending: false }).limit(400);
  if (scope === "mine" && userId) q = q.eq("user_id", userId);
  if (scope === "to_validate") q = q.eq("status", "soumis");
  if (scope === "accounting") q = q.in("status", ["transmise", "valide", "reglee", "comptabilisee"]);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as ExpenseNote[];
}

export async function countToValidate(): Promise<number> {
  const { count } = await supabase
    .from("expense_notes")
    .select("id", { count: "exact", head: true })
    .eq("status", "soumis");
  return count ?? 0;
}

export async function countUnreadExpenseUpdates(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("expense_notes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["reglee", "comptabilisee"])
    .is("employee_notified_at", null);
  if (error) throw error;
  return count ?? 0;
}

export async function createExpense(input: Record<string, unknown>): Promise<string> {
  const { data, error } = await supabase.from("expense_notes").insert(input as never).select("id").single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function updateExpense(id: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from("expense_notes").update(patch as never).eq("id", id);
  if (error) throw error;
}

export async function deleteExpense(id: string) {
  const { error } = await supabase.from("expense_notes").delete().eq("id", id);
  if (error) throw error;
}

export type ExpenseAction = "resubmit" | "reject" | "settle" | "account" | "mark_seen";

export function expenseTransition(
  action: ExpenseAction,
  now: string,
  actorName: string,
  detail?: string,
): Record<string, unknown> {
  if (action === "resubmit") return { status: "soumis", submitted_at: now, reject_reason: null };
  if (action === "reject") return { status: "refuse", reject_reason: detail?.trim() || "Correction demandée" };
  if (action === "settle") {
    return { status: "reglee", settled_at: detail || now.slice(0, 10), settled_by_name: actorName, employee_notified_at: null };
  }
  if (action === "account") {
    return { status: "comptabilisee", accounted_at: now, accounted_by_name: actorName, employee_notified_at: null };
  }
  return { employee_notified_at: now };
}

/** Devine un motif à partir du texte du justificatif (règles simples, sans IA). */
export function guessCategory(text: string | null | undefined): string | null {
  const v = (text ?? "").toLowerCase();
  if (!v.trim()) return null;
  const rules: [string, RegExp][] = [
    ["carburant", /(total ?energies|esso|avia|bp |station|carburant|gazole|diesel|sp ?95|sp ?98|e10|intermarch[ée] station)/],
    ["peage", /(p[ée]age|vinci|asf|cofiroute|aprr|sanef|autoroute)/],
    ["parking", /(parking|horodateur|stationnement|indigo|effia)/],
    ["hotel", /(h[oô]tel|ibis|b&b|campanile|kyriad|novotel|nuit[ée]e)/],
    ["restaurant", /(restaurant|brasserie|pizz|burger|caf[ée]|boulangerie|traiteur|couvert|menu du jour|mcdonald)/],
    ["fournitures", /(bureau|papeterie|cartouche|fourniture|bricolage|leroy merlin|castorama)/],
  ];
  for (const [key, re] of rules) if (re.test(v)) return key;
  return null;
}
