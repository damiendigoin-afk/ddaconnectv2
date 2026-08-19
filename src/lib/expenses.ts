import { supabase } from "@/integrations/supabase/client";

export type ExpenseNote = {
  id: string;
  user_id: string;
  user_name: string | null;
  site_id: string | null;
  spent_on: string;
  category: string;
  merchant: string | null;
  amount_ttc: number;
  vat_amount: number | null;
  receipt_path: string | null;
  status: string;
  reject_reason: string | null;
  notes: string | null;
};

export const EXPENSE_CATEGORIES = [
  { key: "carburant", label: "Carburant" },
  { key: "peage", label: "Péage / parking" },
  { key: "repas", label: "Repas" },
  { key: "hebergement", label: "Hébergement" },
  { key: "fournitures", label: "Fournitures" },
  { key: "transport", label: "Transport" },
  { key: "autre", label: "Autre" },
] as const;

export const EXPENSE_STATUS = [
  { key: "brouillon", label: "Brouillon" },
  { key: "soumis", label: "Soumis" },
  { key: "valide", label: "Validé" },
  { key: "refuse", label: "Refusé" },
] as const;

export function statusTone(status: string) {
  if (status === "valide") return "bg-secondary text-foreground";
  if (status === "refuse") return "bg-status-watch-soft text-status-watch";
  if (status === "soumis") return "bg-brand/10 text-brand";
  return "bg-secondary text-muted-foreground";
}

export async function listExpenses(scope: "mine" | "all", userId: string | null): Promise<ExpenseNote[]> {
  let q = supabase
    .from("expense_notes")
    .select("id, user_id, user_name, site_id, spent_on, category, merchant, amount_ttc, vat_amount, receipt_path, status, reject_reason, notes")
    .order("spent_on", { ascending: false })
    .limit(300);
  if (scope === "mine" && userId) q = q.eq("user_id", userId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ExpenseNote[];
}

export async function createExpense(input: Partial<ExpenseNote>) {
  const { error } = await supabase.from("expense_notes").insert(input as never);
  if (error) throw error;
}

export async function setExpenseStatus(id: string, status: string, reason?: string) {
  const patch: Record<string, unknown> = { status };
  if (status === "soumis") patch['submitted_at'] = new Date().toISOString();
  if (status === "valide" || status === "refuse") patch['reviewed_at'] = new Date().toISOString();
  if (reason !== undefined) patch['reject_reason'] = reason;
  const { error } = await supabase.from("expense_notes").update(patch as never).eq("id", id);
  if (error) throw error;
}

export async function deleteExpense(id: string) {
  const { error } = await supabase.from("expense_notes").delete().eq("id", id);
  if (error) throw error;
}