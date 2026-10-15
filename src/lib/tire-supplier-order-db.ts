/** Commande pneus Districash : écritures internes (aucun appel au portail fournisseur). */
import { supabase } from "@/integrations/supabase/client";
import { findOrByNumber, logEvent, type Actor } from "@/lib/parts";
import {
  findTireOrderDuplicate,
  normPlate,
  TIRE_ORDER_STATUS_PENDING,
  validateSupplierConfirmation,
  type ExistingTireOrder,
  type TireOrderLine,
} from "@/lib/tire-supplier-order";

export async function districashSupplierId(): Promise<string | null> {
  const { data } = await supabase.from("suppliers").select("id").ilike("name", "districash").limit(1);
  return data?.[0]?.id ?? null;
}

/** OR WinMotor connu (jamais créé) sur le site émetteur. */
export async function lookupKnownOr(orNumber: string, siteId: string) {
  const or = await findOrByNumber(orNumber);
  return or && or.site_id === siteId ? or : null;
}

export async function findDuplicateTireOrder(c: { siteId: string; supplierId: string; ref: string; orNumber: string; plate: string }) {
  const { data } = await supabase
    .from("part_orders")
    .select("id, status, supplier_id, requested_or_number, plate, repair_orders(or_number), part_order_lines(physical_reference)")
    .eq("site_id", c.siteId)
    .eq("supplier_id", c.supplierId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(300);
  return findTireOrderDuplicate(c, (data ?? []) as unknown as ExistingTireOrder[]);
}

export async function createTireSupplierOrder(
  o: { siteId: string; supplierId: string; account: string | null; orNumber: string; plate: string; or: { id: string; vehicle_id: string | null } | null; line: TireOrderLine; source: unknown },
  actor: Actor,
): Promise<string> {
  const { data, error } = await supabase
    .from("part_orders")
    .insert({
      site_id: o.siteId,
      supplier_id: o.supplierId,
      order_mode: "detailed",
      destination: o.or || o.orNumber.trim() ? "or" : "stock",
      repair_order_id: o.or?.id ?? null,
      vehicle_id: o.or?.vehicle_id ?? null,
      requested_or_number: o.orNumber.trim() || null,
      plate: normPlate(o.plate) || null,
      status: TIRE_ORDER_STATUS_PENDING,
      supplier_account: o.account,
      transmission_mode: "manual",
      source_quote: o.source as never,
      comment: "Pneus Districash depuis devis — à valider manuellement sur le portail.",
      created_by_name: actor.name,
    })
    .select("id")
    .single();
  if (error) throw error;
  const { error: e2 } = await supabase.from("part_order_lines").insert({ order_id: data.id, line_kind: "part", ...o.line });
  if (e2) throw e2;
  await logEvent({ site_id: o.siteId, entity: "part_order", entity_id: data.id, repair_order_id: o.or?.id ?? null, action: "create_to_transmit", detail: { supplier: "districash", account: o.account } }, actor);
  return data.id;
}

/** Saisie du n° de commande Districash réel : seul passage vers « Commandée ». */
export async function confirmSupplierOrder(orderId: string, siteId: string, ref: string, actor: Actor) {
  const err = validateSupplierConfirmation(ref);
  if (err) throw new Error(err);
  const { error } = await supabase
    .from("part_orders")
    .update({ supplier_order_ref: ref.trim(), status: "ordered", order_date: new Date().toISOString().slice(0, 10), supplier_confirmed_at: new Date().toISOString(), supplier_confirmed_by_name: actor.name })
    .eq("id", orderId)
    .eq("status", TIRE_ORDER_STATUS_PENDING);
  if (error) throw error;
  await logEvent({ site_id: siteId, entity: "part_order", entity_id: orderId, action: "supplier_confirmed", detail: { ref: ref.trim() } }, actor);
}
