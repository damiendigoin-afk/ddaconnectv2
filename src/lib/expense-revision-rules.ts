export const EXPENSE_EDIT_FIELDS = ["site_id", "merchant", "spent_on", "category", "purpose", "payment_method", "amount_ttc", "vat_amount", "vat_rate", "notes", "receipt_path", "receipt_mime", "account_ref", "account_other"] as const;
export type ExpenseEdit = Record<(typeof EXPENSE_EDIT_FIELDS)[number], string | number | null>;

export function requiresAccountingInstruction(note: { accounted_at?: string | null; reconciled_at?: string | null; settled_at?: string | null; exported_at?: string | null }) {
  return Boolean(note.accounted_at || note.reconciled_at || note.settled_at || note.exported_at);
}

export function revisionMailKind(cancelled: boolean, previousRecipient: string | null, recipient: string): "initial" | "replace" | "cancel" {
  if (cancelled || (previousRecipient && previousRecipient !== recipient)) return "cancel";
  return previousRecipient ? "replace" : "initial";
}

export function expenseDeliveryKey(noteId: string, revision: number, recipient: string, kind: string) {
  return `expense:${noteId}:v${revision}:${kind}:${recipient.toLowerCase()}`;
}

export function canRetryExpenseDelivery(state: string) {
  return state === "ready" || state === "failed";
}

export function expenseRevisionTargets(cancelled: boolean, to: string, recipients: Map<string, number>) {
  const jobs = [...recipients].map(([recipient, target_revision]) => ({ recipient, target_revision, kind: revisionMailKind(cancelled, recipient, to) }));
  if (!cancelled && !recipients.has(to)) jobs.push({ recipient: to, target_revision: 0, kind: "initial" });
  return jobs;
}