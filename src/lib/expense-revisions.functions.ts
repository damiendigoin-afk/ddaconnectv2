import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EXPENSE_EDIT_FIELDS } from "./expense-revision-rules";

export const correctExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ expenseId: z.string().uuid(), revision: z.number().int().positive(), action: z.enum(["edit", "cancel"]), patch: z.record(z.union([z.string(), z.number().finite(), z.null()])), reason: z.string().trim().min(3).max(1000), instruction: z.string().max(2000).optional() }).parse(value))
  .handler(async ({ data, context }) => {
    if (Object.keys(data.patch).some(k => !(EXPENSE_EDIT_FIELDS as readonly string[]).includes(k))) throw new Error("Champ non modifiable");
    const { data: result, error } = await context.supabase.rpc("correct_expense", { _id: data.expenseId, _revision: data.revision, _action: data.action, _patch: data.patch, _reason: data.reason, _instruction: data.instruction ?? "" });
    if (error) throw error;
    return { ok: true, note: result };
  });

export const acknowledgeExpenseDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ deliveryId: z.string().uuid(), reference: z.string().trim().min(3).max(1000) }).parse(v))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("ack_expense_revision_delivery", { _delivery: data.deliveryId, _reference: data.reference });
    if (error) throw error;
    return { ok: true };
  });