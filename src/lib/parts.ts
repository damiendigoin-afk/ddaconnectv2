import { simplifiedEnrichment } from "@/lib/receipt-lines";
/**
 * Pièces & achats V3 (Phase B) : commandes, réceptions physiques, stock, pointage OR, temps, travaux terminés.
 * Écritures toujours sur un site explicite (site par défaut de l'utilisateur) — jamais silencieusement sur l'autre.
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizePlate, winmotorOrHistory } from "@/lib/plate";
import { allocationPlan, canAttachTo, orphanReceiptsForPlate, type AttachLine, type OrphanReceipt } from "@/lib/receipt-attach";
import {
  movementDeltas,
  nextPamp,
  normalizeRef,
  orderLineStatus,
  orderStatus,
  stateAfterChange,
  type MovementType,
  type WorkState,
} from "@/lib/parts-rules";

export type Actor = { userId: string | null; name: string };

/** Site d'action : site par défaut du profil, sinon site actif (hors vue groupe). */
export function actionSiteId(profileSite: string | null | undefined, active: string, isGroup: boolean): string | null {
  return profileSite ?? (!isGroup && active && active !== "groupe" ? active : null);
}

export async function logEvent(e: { site_id: string | null; entity: string; entity_id?: string | null; repair_order_id?: string | null; action: string; detail?: unknown }, actor: Actor) {
  await supabase.from("parts_events").insert({
    site_id: e.site_id,
    entity: e.entity,
    entity_id: e.entity_id ?? null,
    repair_order_id: e.repair_order_id ?? null,
    action: e.action,
    detail: (e.detail ?? null) as never,
    created_by_name: actor.name,
  });
}

export async function openRegularization(r: { site_id: string; kind: string; source_table?: string; source_id?: string | null; repair_order_id?: string | null; supplier_id?: string | null; physical_reference?: string | null; plate?: string | null; comment?: string | null }, actor: Actor) {
  await supabase.from("parts_regularizations").insert({ ...r, created_by_name: actor.name });
}

// ---------- OR ----------
export type OrLite = { id: string; or_number: string | null; site_id: string | null; vehicle_id: string | null; plate: string | null };

export async function findOrByNumber(num: string): Promise<OrLite | null> {
  const n = num.trim();
  if (!n) return null;
  const { data } = await supabase
    .from("repair_orders")
    .select("id, or_number, site_id, vehicle_id, vehicles(plate)")
    .eq("or_number", n)
    .order("or_date", { ascending: false })
    .limit(1);
  const r = data?.[0] as unknown as (OrLite & { vehicles: { plate: string } | null }) | undefined;
  return r ? { id: r.id, or_number: r.or_number, site_id: r.site_id, vehicle_id: r.vehicle_id, plate: r.vehicles?.plate ?? null } : null;
}

export async function findOrsByPlate(plate: string): Promise<{ vehicleId: string | null; ors: OrLite[]; wmHistory: { or_number: string; date: string }[] }> {
  const pn = normalizePlate(plate);
  if (!pn) return { vehicleId: null, ors: [], wmHistory: [] };
  const { data: veh } = await supabase.from("vehicles").select("id, plate").eq("plate_normalized", pn).limit(1);
  const v = veh?.[0];
  let ors: OrLite[] = [];
  if (v) {
    const { data } = await supabase
      .from("repair_orders")
      .select("id, or_number, site_id, vehicle_id")
      .eq("vehicle_id", v.id)
      .not("or_number", "is", null)
      .order("or_date", { ascending: false })
      .limit(10);
    ors = (data ?? []).map((o) => ({ ...o, plate: v.plate }));
  }
  let wmHistory: { or_number: string; date: string }[] = [];
  if (!v || !ors.length) {
    // Historique WinMotor : information seule, jamais une cible de rattachement.
    const { data: wm } = await supabase.from("winmotor_invoices").select("or_number, invoice_date").eq("plate_normalized", pn).order("invoice_date", { ascending: false }).limit(20);
    wmHistory = winmotorOrHistory(wm ?? []);
  }
  return { vehicleId: v?.id ?? null, ors, wmHistory };
}

/** Réceptions validées sans OR, même site, même immatriculation normalisée (non annulées). */
export async function listOrphanReceiptsForPlate(siteId: string | null, plate: string | null) {
  if (normalizePlate(plate ?? "").length < 5) return [];
  let q = supabase
    .from("part_receipts")
    .select("id, site_id, plate, repair_order_id, status, cancelled_at, received_at, received_by_name, source_document_id, supplier_order_ref, free_reference, suppliers(name), inbox_documents:source_document_id(extracted), part_receipt_lines(id, article_id, condition, qty_received, qty_allocated, repair_order_id, physical_reference, designation)")
    .is("repair_order_id", null)
    .not("plate", "is", null)
    .neq("status", "cancelled")
    .order("received_at", { ascending: false })
    .limit(300);
  if (siteId) q = q.eq("site_id", siteId);
  const { data } = await q;
  return orphanReceiptsForPlate((data ?? []) as unknown as (OrphanReceipt & Record<string, unknown>)[], plate, siteId);
}

/** Rattachement confirmé par le mécanicien : OR + véhicule, lignes, affectations manquantes (aucun nouveau receipt_in), régularisations fermées sans DELETE. */
export async function attachReceiptToOr(receiptId: string, or: { id: string; or_number: string | null; site_id: string | null; vehicle_id: string | null }, actor: Actor): Promise<{ allocated: number }> {
  if (!canAttachTo(or)) throw new Error("OR officiel requis");
  const { data: rec, error } = await supabase.from("part_receipts").select("id, site_id, status, cancelled_at, repair_order_id, part_receipt_lines(id, article_id, condition, qty_received, qty_allocated, repair_order_id, physical_reference, designation, destination)").eq("id", receiptId).single();
  if (error) throw error;
  if (rec.status === "cancelled" || rec.cancelled_at) throw new Error("Réception annulée");
  if (rec.repair_order_id && rec.repair_order_id !== or.id) throw new Error("Réception déjà rattachée à un autre OR");
  const { error: e1 } = await supabase.from("part_receipts").update({ repair_order_id: or.id, vehicle_id: or.vehicle_id }).eq("id", receiptId).is("repair_order_id", null);
  if (e1) throw e1;
  const lines = (rec.part_receipt_lines ?? []) as unknown as (AttachLine & { destination: string })[];
  const plan = allocationPlan(lines, or.id);
  const lineIds = lines.filter((l) => !l.repair_order_id).map((l) => l.id);
  if (lineIds.length) await supabase.from("part_receipt_lines").update({ repair_order_id: or.id, destination: "or" }).in("id", lineIds).is("repair_order_id", null);
  let allocated = 0;
  for (const p of plan) {
    await allocateToOr({ articleId: p.line.article_id!, siteId: rec.site_id, orId: or.id, qty: p.qty, ref: p.line.physical_reference ?? "", designation: p.line.designation, receiptLineId: p.line.id }, actor);
    await supabase.from("part_receipt_lines").update({ qty_allocated: Number(p.line.qty_allocated || 0) + p.qty }).eq("id", p.line.id);
    allocated += p.qty;
  }
  const now = new Date().toISOString();
  const closing = `Réception rattachée à l'OR ${or.or_number} (confirmé par ${actor.name})`;
  const close = { status: "closed", closed_by: actor.userId, closed_by_name: actor.name, closed_at: now, closing_comment: closing, repair_order_id: or.id };
  await supabase.from("parts_regularizations").update(close).eq("status", "open").eq("source_id", receiptId).eq("kind", "reception_sans_commande");
  if (lines.length) await supabase.from("parts_regularizations").update(close).eq("status", "open").eq("kind", "destination_inconnue").in("source_id", lines.map((l) => l.id));
  await logEvent({ site_id: rec.site_id, entity: "part_receipt", entity_id: receiptId, repair_order_id: or.id, action: "attach_or", detail: { or_number: or.or_number, allocated } }, actor);
  return { allocated };
}

// ---------- Stock ----------
export type StockRow = {
  id: string;
  site_id: string;
  physical_reference: string;
  designation: string | null;
  unit: string;
  is_oil: boolean;
  location: string | null;
  pamp: number | null;
  last_purchase_price: number | null;
  last_purchase_at: string | null;
  last_supplier_id: string | null;
  opening_value_source: string | null;
  available_qty: number;
  allocated_qty: number;
  quarantine_qty: number;
  first_receipt_at: string | null;
};

export async function listStock(opts: { siteId: string | null; q?: string }): Promise<StockRow[]> {
  let q = supabase.from("stock_articles").select("*").order("physical_reference").limit(500);
  if (opts.siteId) q = q.eq("site_id", opts.siteId);
  if (opts.q?.trim()) {
    const s = opts.q.trim().replace(/[%,()]/g, " ");
    q = q.or(`reference_normalized.ilike.%${normalizeRef(s)}%,designation.ilike.%${s}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  const ids = (data ?? []).map((a) => a.id);
  const levels = ids.length ? (await supabase.from("stock_levels").select("*").in("article_id", ids)).data ?? [] : [];
  const byId = new Map(levels.map((l) => [l.article_id, l]));
  return (data ?? []).map((a) => {
    const l = byId.get(a.id);
    return {
      ...a,
      available_qty: Number(l?.available_qty ?? 0),
      allocated_qty: Number(l?.allocated_qty ?? 0),
      quarantine_qty: Number(l?.quarantine_qty ?? 0),
      first_receipt_at: l?.first_receipt_at ?? null,
    } as StockRow;
  });
}

export async function findStockByRef(siteId: string | null, ref: string): Promise<StockRow[]> {
  const n = normalizeRef(ref);
  if (!n) return [];
  let q = supabase.from("stock_articles").select("id").eq("reference_normalized", n);
  if (siteId) q = q.eq("site_id", siteId);
  const { data } = await q;
  if (!data?.length) return [];
  const all = await listStock({ siteId, q: ref });
  return all.filter((r) => normalizeRef(r.physical_reference) === n);
}

export async function levelOf(articleId: string) {
  const { data } = await supabase.from("stock_levels").select("*").eq("article_id", articleId).maybeSingle();
  return { available: Number(data?.available_qty ?? 0), allocated: Number(data?.allocated_qty ?? 0), quarantine: Number(data?.quarantine_qty ?? 0) };
}

export async function ensureArticle(siteId: string, ref: string, designation: string | null, isOil = false): Promise<string> {
  const n = normalizeRef(ref);
  const { data: ex } = await supabase.from("stock_articles").select("id, designation").eq("site_id", siteId).eq("reference_normalized", n).maybeSingle();
  if (ex) {
    if (!ex.designation && designation) await supabase.from("stock_articles").update({ designation }).eq("id", ex.id);
    return ex.id;
  }
  const { data, error } = await supabase
    .from("stock_articles")
    .insert({ site_id: siteId, physical_reference: ref.trim(), reference_normalized: n, designation, is_oil: isOil, unit: isOil ? "l" : "u" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function addMovement(
  m: { site_id: string; article_id: string; type: MovementType; qty: number; unit_cost?: number | null; repair_order_id?: string | null; receipt_line_id?: string | null; reason?: string | null; fromQuarantine?: boolean },
  actor: Actor,
): Promise<string> {
  const d = movementDeltas(m.type, m.qty, { fromQuarantine: !!m.fromQuarantine });
  const { data, error } = await supabase
    .from("stock_movements")
    .insert({
      site_id: m.site_id,
      article_id: m.article_id,
      movement_type: m.type,
      qty: m.qty,
      ...d,
      unit_cost: m.unit_cost ?? null,
      repair_order_id: m.repair_order_id ?? null,
      receipt_line_id: m.receipt_line_id ?? null,
      reason: m.reason ?? null,
      created_by_name: actor.name,
    })
    .select("id")
    .single();
  if (error) throw error;
  if (m.type === "allocate_to_or" || m.type === "manual_adjustment" || m.type === "supplier_return_out") {
    const l = await levelOf(m.article_id);
    if (l.available < 0) {
      const { data: a } = await supabase.from("stock_articles").select("physical_reference").eq("id", m.article_id).single();
      await openRegularization({ site_id: m.site_id, kind: "stock_negatif", source_table: "stock_articles", source_id: m.article_id, physical_reference: a?.physical_reference ?? null, repair_order_id: m.repair_order_id ?? null, comment: `Stock disponible ${l.available}` }, actor);
    }
  }
  return data.id;
}

export async function adjustStock(articleId: string, siteId: string, delta: number, reason: string, actor: Actor) {
  if (!reason.trim()) throw new Error("Motif obligatoire");
  await addMovement({ site_id: siteId, article_id: articleId, type: "manual_adjustment", qty: delta, reason }, actor);
}

export async function supplierReturnOut(articleId: string, siteId: string, qty: number, fromQuarantine: boolean, reason: string, actor: Actor) {
  await addMovement({ site_id: siteId, article_id: articleId, type: "supplier_return_out", qty, fromQuarantine, reason }, actor);
}

export async function updateArticle(id: string, patch: { location?: string | null; designation?: string | null; pamp?: number | null; opening_value_source?: "historical" | "estimated" | null }, siteId: string, actor: Actor) {
  const { error } = await supabase.from("stock_articles").update(patch).eq("id", id);
  if (error) throw error;
  await logEvent({ site_id: siteId, entity: "stock_article", entity_id: id, action: "update", detail: patch }, actor);
}

export async function listMovements(articleId: string) {
  const { data } = await supabase.from("stock_movements").select("*").eq("article_id", articleId).order("created_at", { ascending: false }).limit(100);
  return data ?? [];
}

/** Affecte une quantité de stock à un OR + ligne de pointage commune « en attente ». */
export async function allocateToOr(a: { articleId: string; siteId: string; orId: string; qty: number; ref: string; designation: string | null; receiptLineId?: string | null; isOil?: boolean }, actor: Actor) {
  const mvId = await addMovement({ site_id: a.siteId, article_id: a.articleId, type: "allocate_to_or", qty: a.qty, repair_order_id: a.orId, receipt_line_id: a.receiptLineId ?? null }, actor);
  await supabase.from("or_part_usage").insert({
    repair_order_id: a.orId,
    site_id: a.siteId,
    article_id: a.articleId,
    receipt_line_id: a.receiptLineId ?? null,
    movement_id: mvId,
    item_kind: a.isOil ? "oil" : "part",
    physical_reference: a.ref,
    designation: a.designation,
    qty_allocated: a.qty,
    created_by_name: actor.name,
  });
  await markOrChanged(a.orId, a.siteId, actor, "allocation");
}

// ---------- Commandes ----------
export type OrderLineInput = { line_kind: "part" | "fee" | "deposit"; physical_reference: string; designation: string; qty_ordered: number | null; expected_unit_cost_ht: number | null };

export async function createOrder(
  o: { site_id: string; supplier_id: string | null; source_document_id?: string | null; order_mode: "simplified" | "detailed"; destination: "or" | "store_sale" | "stock"; repair_order_id: string | null; vehicle_id: string | null; plate: string | null; appointment_date: string | null; expected_delivery_date?: string | null; order_date?: string | null; supplier_order_ref: string | null; comment: string | null; requested_or_number?: string | null; lines: OrderLineInput[] },
  actor: Actor,
) {
  const { lines, ...head } = o;
  const { data, error } = await supabase.from("part_orders").insert({ ...head, created_by_name: actor.name }).select("id").single();
  if (error) throw error;
  const clean = lines.filter((l) => l.physical_reference.trim() || l.designation.trim());
  if (clean.length) {
    const { error: e2 } = await supabase.from("part_order_lines").insert(
      clean.map((l) => ({ order_id: data.id, line_kind: l.line_kind, physical_reference: l.physical_reference.trim() || null, designation: l.designation.trim() || null, qty_ordered: l.qty_ordered, expected_unit_cost_ht: l.expected_unit_cost_ht })),
    );
    if (e2) throw e2;
  }
  await logEvent({ site_id: o.site_id, entity: "part_order", entity_id: data.id, repair_order_id: o.repair_order_id, action: "create", detail: { mode: o.order_mode, lines: clean.length } }, actor);
  return data.id;
}

/** RDV facultatif d'une commande (donnée logistique, saisie libre). */
export async function setOrderDates(orderId: string, d: { appointment_date: string | null }) {
  const { error } = await supabase.from("part_orders").update({ appointment_date: d.appointment_date || null }).eq("id", orderId);
  if (error) throw error;
}

const ORDER_SELECT = "*, suppliers(name), repair_orders(or_number), part_order_lines(*), inbox_documents(id, extracted, storage_path, file_name, mime_type, file_size, created_at)";

/** Rattache / corrige le fournisseur d'une commande (et de son document source). Interdit sur commande annulée. */
export async function setOrderSupplier(o: { id: string; site_id: string; status: string; source_document_id: string | null }, supplierId: string, actor: Actor) {
  if (o.status === "cancelled") throw new Error("Commande annulée : fournisseur non modifiable");
  const { error } = await supabase.from("part_orders").update({ supplier_id: supplierId }).eq("id", o.id);
  if (error) throw error;
  if (o.source_document_id) {
    const { linkDocSupplier } = await import("@/lib/supplier-docs");
    await linkDocSupplier(o.source_document_id, supplierId);
  }
  await logEvent({ site_id: o.site_id, entity: "part_order", entity_id: o.id, action: "supplier_set", detail: { supplier_id: supplierId } }, actor);
}

export type OrderEditHead = { supplier_id: string | null; supplier_order_ref: string | null; order_date: string | null; comment: string | null; destination: "or" | "store_sale" | "stock"; repair_order_id: string | null; vehicle_id: string | null; plate: string | null; requested_or_number: string | null };

/** Modification manuelle d'une commande existante (même ID, mêmes lignes) — transaction serveur + historique avant/après. */
export async function updateOrder(o: { id: string; supplier_id: string | null; source_document_id: string | null }, head: OrderEditHead, lines: ReturnType<typeof import("@/lib/order-edit-rules").editPayloadLines>, actor: Actor) {
  const { data, error } = await supabase.rpc("update_part_order", { _order: o.id, _head: head as never, _lines: lines as never, _user_name: actor.name ?? "" });
  if (error) throw new Error(error.message);
  if (head.supplier_id && head.supplier_id !== o.supplier_id && o.source_document_id) {
    const { linkDocSupplier } = await import("@/lib/supplier-docs");
    await linkDocSupplier(o.source_document_id, head.supplier_id);
  }
  return data as { updated: number; inserted: number; deleted: number; warnings: string[] };
}

/** Lignes de commande liées à une facture (coût réel ou rapprochement fournisseur). */
export async function invoicedOrderLineIds(lineIds: string[]): Promise<Set<string>> {
  if (!lineIds.length) return new Set();
  const { data } = await supabase.from("part_receipt_lines").select("id, order_line_id, unit_cost_real, supplier_cost_lines(status)").in("order_line_id", lineIds);
  const out = new Set<string>();
  for (const r of (data ?? []) as { order_line_id: string | null; unit_cost_real: number | null; supplier_cost_lines: { status: string }[] | null }[]) {
    if (r.order_line_id && (r.unit_cost_real != null || (r.supplier_cost_lines ?? []).some((c) => c.status !== "ignored"))) out.add(r.order_line_id);
  }
  return out;
}

export async function listOrders(f: { siteId: string | null; status?: string; supplierId?: string; orId?: string }) {
  let q = supabase.from("part_orders").select(ORDER_SELECT).order("created_at", { ascending: false }).limit(200);
  if (f.siteId) q = q.eq("site_id", f.siteId);
  if (f.status) q = q.eq("status", f.status);
  if (f.supplierId) q = q.eq("supplier_id", f.supplierId);
  if (f.orId) q = q.eq("repair_order_id", f.orId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function getOrder(id: string) {
  const { data, error } = await supabase.from("part_orders").select(ORDER_SELECT).eq("id", id).single();
  if (error) throw error;
  const { data: receipts } = await supabase.from("part_receipts").select("id, received_at, received_by_name, receipt_type, comment, status, cancel_reason, source_document_id, inbox_documents(id, storage_path, file_name, mime_type, file_size, created_at)").eq("order_id", id).order("received_at", { ascending: false });
  return { ...data, receipts: receipts ?? [] };
}

// ---------- Réceptions ----------
export type ReceiptLineInput = {
  order_line_id: string | null;
  physical_reference: string;
  designation: string;
  qty_expected: number | null;
  /** Valeurs d'affichage conservées lors d'une réception depuis commande. */
  qty_ordered?: number | null;
  qty_already_received?: number;
  qty_received: number;
  condition: "usable" | "damaged_return" | "to_check";
  destination: "or" | "store_sale" | "stock" | "unknown";
  allocate_qty: number;
  unit_cost: number | null;
  expected_cost: number | null;
  ordered_reference: string | null;
  comment: string;
};

export async function validateReceipt(
  r: { site_id: string; supplier_id: string | null; order_id: string | null; repair_order_id: string | null; vehicle_id: string | null; plate: string | null; source_document_id: string | null; receipt_type: "document" | "physical_without_document" | "invoice_as_delivery"; packages: string | null; comment: string | null; requested_or_number?: string | null; supplier_order_ref?: string | null; free_reference?: string | null; lines: ReceiptLineInput[] },
  actor: Actor,
) {
  const { lines: inLines, ...head } = r;
  let lines = inLines;
  // OR propre à une ligne de commande (modification manuelle multi-OR), sinon OR de la réception.
  const lineOrMap = new Map<string, string>();
  if (r.order_id) {
    const { data: ol } = await supabase.from("part_order_lines").select("id, repair_order_id").eq("order_id", r.order_id);
    for (const x of ol ?? []) if (x.repair_order_id) lineOrMap.set(x.id, x.repair_order_id);
  }
  // Commande simplifiée sans lignes choisie explicitement : on l'enrichit des lignes reçues (traçabilité commande → BL → réception).
  if (r.order_id) {
    const { data: ord } = await supabase.from("part_orders").select("order_mode, part_order_lines(id)").eq("id", r.order_id).single();
    const toAdd = simplifiedEnrichment(ord ? { order_mode: ord.order_mode, line_count: (ord.part_order_lines as unknown[] | null)?.length ?? 0 } : null, lines);
    if (toAdd.length) {
      const { data: created, error: eo } = await supabase.from("part_order_lines").insert(
        toAdd.map((l) => ({ order_id: r.order_id!, line_kind: "part", physical_reference: l.physical_reference.trim() || null, designation: l.designation.trim() || null, qty_ordered: l.qty_received, expected_unit_cost_ht: l.unit_cost })),
      ).select("id");
      if (eo) throw eo;
      const ids = new Map<ReceiptLineInput, string | null>(toAdd.map((l, i) => [l, (created?.[i]?.id as string | undefined) ?? null]));
      lines = lines.map((l) => (ids.has(l) ? { ...l, order_line_id: ids.get(l) ?? null } : l));
    }
  }
  const { data: rec, error } = await supabase.from("part_receipts").insert({ ...head, received_by_name: actor.name }).select("id").single();
  if (error) throw error;

  if (r.receipt_type === "physical_without_document") {
    await openRegularization({ site_id: r.site_id, kind: "reception_sans_document", source_table: "part_receipts", source_id: rec.id, supplier_id: r.supplier_id, repair_order_id: r.repair_order_id, plate: r.plate, comment: r.comment }, actor);
  }

  for (const l of lines) {
    if (!(l.qty_received > 0) && !l.order_line_id) continue;
    const ref = l.physical_reference.trim();
    const wrongRef = !!(l.ordered_reference && ref && normalizeRef(l.ordered_reference) !== normalizeRef(ref));
    const lineOr = l.destination === "or" ? ((l.order_line_id && lineOrMap.get(l.order_line_id)) || r.repair_order_id) : null;
    let articleId: string | null = null;
    if (ref && l.qty_received > 0) articleId = await ensureArticle(r.site_id, ref, l.designation.trim() || null);
    const { data: rl, error: e2 } = await supabase
      .from("part_receipt_lines")
      .insert({
        receipt_id: rec.id,
        order_line_id: l.order_line_id,
        article_id: articleId,
        physical_reference: ref || null,
        designation: l.designation.trim() || null,
        qty_expected: l.qty_expected,
        qty_received: l.qty_received,
        condition: l.condition,
        destination: l.destination,
        repair_order_id: lineOr,
        qty_allocated: 0,
        unit_cost_provisional: l.unit_cost,
        wrong_reference: wrongRef,
        over_receipt: l.qty_expected != null && l.qty_received > l.qty_expected,
        price_gap: l.unit_cost != null && l.expected_cost != null && Math.abs(l.unit_cost - l.expected_cost) > 0.009,
        comment: l.comment.trim() || null,
      })
      .select("id")
      .single();
    if (e2) throw e2;

    if (l.qty_received > 0 && !ref) {
      await openRegularization({ site_id: r.site_id, kind: "reference_a_completer", source_table: "part_receipt_lines", source_id: rl.id, supplier_id: r.supplier_id, repair_order_id: lineOr, plate: r.plate, comment: l.designation || "Pièce reçue sans référence" }, actor);
    }
    if (articleId) {
      if (l.condition === "usable") {
        const lv = await levelOf(articleId);
        const { data: art } = await supabase.from("stock_articles").select("pamp").eq("id", articleId).single();
        await addMovement({ site_id: r.site_id, article_id: articleId, type: "receipt_in", qty: l.qty_received, unit_cost: l.unit_cost, receipt_line_id: rl.id }, actor);
        if (l.unit_cost != null) {
          await supabase
            .from("stock_articles")
            .update({ pamp: nextPamp(lv.available + lv.allocated, art?.pamp ?? null, l.qty_received, l.unit_cost), last_purchase_price: l.unit_cost, last_purchase_at: new Date().toISOString(), last_supplier_id: r.supplier_id })
            .eq("id", articleId);
        }
        if (lineOr && l.allocate_qty > 0) {
          const q = Math.min(l.allocate_qty, l.qty_received);
          await allocateToOr({ articleId, siteId: r.site_id, orId: lineOr, qty: q, ref, designation: l.designation || null, receiptLineId: rl.id }, actor);
          await supabase.from("part_receipt_lines").update({ qty_allocated: q }).eq("id", rl.id);
        }
      } else {
        await addMovement({ site_id: r.site_id, article_id: articleId, type: "damaged_quarantine", qty: l.qty_received, receipt_line_id: rl.id, reason: l.condition }, actor);
        await openRegularization({ site_id: r.site_id, kind: l.condition === "damaged_return" ? "piece_endommagee" : "piece_a_verifier", source_table: "part_receipt_lines", source_id: rl.id, supplier_id: r.supplier_id, repair_order_id: lineOr, physical_reference: ref, plate: r.plate, comment: l.comment || null }, actor);
      }
      if (l.destination === "unknown" && l.condition === "usable") {
        await openRegularization({ site_id: r.site_id, kind: "destination_inconnue", source_table: "part_receipt_lines", source_id: rl.id, supplier_id: r.supplier_id, physical_reference: ref, plate: r.plate }, actor);
      }
    }
    if (l.order_line_id && l.qty_received > 0) {
      const { data: ol } = await supabase.from("part_order_lines").select("qty_ordered, qty_received").eq("id", l.order_line_id).single();
      const rec2 = Number(ol?.qty_received ?? 0) + l.qty_received;
      await supabase.from("part_order_lines").update({ qty_received: rec2, status: orderLineStatus(ol?.qty_ordered ?? null, rec2) }).eq("id", l.order_line_id);
    }
  }

  if (r.order_id) {
    const { data: ols } = await supabase.from("part_order_lines").select("status, line_kind").eq("order_id", r.order_id);
    await supabase.from("part_orders").update({ status: orderStatus(ols ?? [], true) }).eq("id", r.order_id);
  }
  await logEvent({ site_id: r.site_id, entity: "part_receipt", entity_id: rec.id, repair_order_id: r.repair_order_id, action: "validate", detail: { lines: lines.length, type: r.receipt_type } }, actor);
  return rec.id;
}

/**
 * BL couvrant plusieurs commandes : une réception par commande, toutes avec le même source_document_id
 * et le même n° de BL. Idempotent : les réceptions déjà créées depuis ce document (non annulées) sont sautées.
 * Le document n'est marqué traité que si toutes ses lignes sont affectées ou acceptées sans commande.
 */
export async function validateMultiReceipt(
  r: { site_id: string; supplier_id: string; source_document_id: string; bl_number: string | null; payloads: import("@/lib/multi-order-reception").MultiReceiptPayload[]; complete: boolean },
  actor: Actor,
): Promise<{ created: string[]; skipped: number }> {
  const { payloadsToCreate } = await import("@/lib/multi-order-reception");
  const { data: existing, error } = await supabase.from("part_receipts").select("order_id, status").eq("source_document_id", r.source_document_id);
  if (error) throw error;
  const todo = payloadsToCreate(r.payloads, existing ?? []);
  const created: string[] = [];
  const bl = r.bl_number ? `BL n° ${r.bl_number}` : "BL";
  for (const p of todo) {
    const id = await validateReceipt({
      site_id: r.site_id, supplier_id: r.supplier_id, order_id: p.order_id, repair_order_id: p.repair_order_id, vehicle_id: null, plate: p.plate,
      source_document_id: r.source_document_id, receipt_type: "document", packages: null,
      comment: `${bl} multi-commandes${p.order_id ? "" : " — lignes acceptées sans commande"}`,
      requested_or_number: p.requested_or_number, supplier_order_ref: p.supplier_order_ref,
      lines: p.lines.map((l) => ({ ...l, condition: "usable" as const, allocate_qty: l.destination === "or" ? l.qty_received : 0, comment: "" })),
    }, actor);
    created.push(id);
    if (!p.order_id) await openRegularization({ site_id: r.site_id, kind: "reception_sans_commande", source_table: "part_receipts", source_id: id, supplier_id: r.supplier_id, comment: `${bl} : lignes non rapprochées acceptées sans commande` }, actor);
  }
  if (r.complete) {
    const first = created[0];
    await supabase.from("inbox_documents").update({ status: "valide", ...(first ? { linked_kind: "part_receipt", linked_id: first } : {}) }).eq("id", r.source_document_id).is("linked_id", null);
    await supabase.from("inbox_documents").update({ status: "valide" }).eq("id", r.source_document_id);
  }
  return { created, skipped: r.payloads.length - todo.length };
}

export async function listReceipts(siteId: string | null) {
  let q = supabase.from("part_receipts").select("*, suppliers(name), repair_orders(or_number), part_receipt_lines(id, physical_reference, designation, qty_received, condition)").order("received_at", { ascending: false }).limit(50);
  if (siteId) q = q.eq("site_id", siteId);
  const { data } = await q;
  return data ?? [];
}

/** Signalement d'anomalie : statut « incident » + journal. Aucun mouvement de stock. */
export async function cancelReceiptIncident(id: string, siteId: string, reason: string, actor: Actor) {
  await supabase.from("part_receipts").update({ status: "incident", comment: reason }).eq("id", id);
  await logEvent({ site_id: siteId, entity: "part_receipt", entity_id: id, action: "incident", detail: { reason } }, actor);
}

/** Annulation d'une réception saisie par erreur : mouvements inverses exacts, reliquat commande remis, sans DELETE. */
export async function cancelReceipt(id: string, reason: string, actor: Actor) {
  const { data, error } = await supabase.rpc("cancel_part_receipt", { _receipt: id, _reason: reason, _user_name: actor.name ?? "" });
  if (error) throw new Error(error.message);
  return data as { reversed_movements: number; order_lines: number };
}

/** Annulation d'une commande : seules les quantités encore en attente sont annulées ; les réceptions restent. */
export async function cancelOrder(id: string, reason: string, actor: Actor) {
  const { data, error } = await supabase.rpc("cancel_part_order", { _order: id, _reason: reason, _user_name: actor.name ?? "" });
  if (error) throw new Error(error.message);
  return data as { qty_already_received: number; lines_cancelled: number };
}

export async function listSupplierDocs(siteId: string | null) {
  let q = supabase.from("inbox_documents").select("id, file_name, status, created_at, extracted").eq("doc_type", "facture_fournisseur").neq("status", "archive").order("created_at", { ascending: false }).limit(30);
  if (siteId) q = q.eq("site_id", siteId);
  const { data } = await q;
  return data ?? [];
}

// ---------- Dossier OR : état, pointage, temps ----------
export async function getWorkState(orId: string) {
  const { data } = await supabase.from("or_work_state").select("*").eq("repair_order_id", orId).maybeSingle();
  return data;
}

export async function markOrChanged(orId: string, siteId: string | null, actor: Actor, action: string) {
  const cur = await getWorkState(orId);
  const next = stateAfterChange((cur?.state as WorkState) ?? null);
  if (cur && cur.state !== next) {
    await supabase.from("or_work_state").update({ state: next }).eq("repair_order_id", orId);
  }
  await logEvent({ site_id: siteId, entity: "or", entity_id: orId, repair_order_id: orId, action }, actor);
}

export async function finishWork(orId: string, siteId: string, opts: { forced: boolean; reason: string | null; pending: number }, actor: Actor) {
  const row = { repair_order_id: orId, site_id: siteId, state: "travaux_termines", finished_at: new Date().toISOString(), finished_by: actor.userId, finished_by_name: actor.name, forced: opts.forced, force_reason: opts.reason };
  const { error } = await supabase.from("or_work_state").upsert(row);
  if (error) throw error;
  if (opts.forced) {
    await openRegularization({ site_id: siteId, kind: "travaux_forces", source_table: "or_work_state", source_id: orId, repair_order_id: orId, comment: `${opts.pending} ligne(s) non traitée(s)${opts.reason ? ` — ${opts.reason}` : ""}` }, actor);
  }
  await logEvent({ site_id: siteId, entity: "or", entity_id: orId, repair_order_id: orId, action: opts.forced ? "work_done_forced" : "work_done", detail: opts }, actor);
}

export async function listUsage(orId: string) {
  const { data } = await supabase.from("or_part_usage").select("*").eq("repair_order_id", orId).order("created_at");
  return data ?? [];
}

export async function confirmUsage(u: { id: string; orId: string; siteId: string | null; status: "used" | "not_used" | "partial"; qty_used: number | null; reason: string | null; comment: string | null }, actor: Actor) {
  const { error } = await supabase
    .from("or_part_usage")
    .update({ usage_status: u.status, qty_used: u.qty_used, reason: u.reason, comment: u.comment, confirmed_by: actor.userId, confirmed_by_name: actor.name, confirmed_at: new Date().toISOString() })
    .eq("id", u.id);
  if (error) throw error;
  await markOrChanged(u.orId, u.siteId, actor, `usage_${u.status}`);
}

/** Remet en stock une pièce affectée non utilisée (mouvement séparé, explicite). */
export async function returnUnusedToStock(u: { id: string; orId: string; siteId: string; articleId: string; qty: number }, actor: Actor) {
  await addMovement({ site_id: u.siteId, article_id: u.articleId, type: "deallocate_from_or", qty: u.qty, repair_order_id: u.orId, reason: "Non utilisée — remise en stock" }, actor);
  const { data } = await supabase.from("or_part_usage").select("qty_allocated").eq("id", u.id).single();
  await supabase.from("or_part_usage").update({ qty_allocated: Math.max(0, Number(data?.qty_allocated ?? 0) - u.qty) }).eq("id", u.id);
  await markOrChanged(u.orId, u.siteId, actor, "deallocate");
}

/** Ajout d'une pièce/huile/fourniture réellement utilisée non prévue (sans approbation). */
export async function addUnplannedUsage(a: { orId: string; siteId: string; kind: "part" | "oil" | "consumable"; ref: string; designation: string; qty: number }, actor: Actor) {
  let articleId: string | null = null;
  let movementId: string | null = null;
  if (a.kind !== "consumable" && a.ref.trim()) {
    articleId = await ensureArticle(a.siteId, a.ref, a.designation || null, a.kind === "oil");
    movementId = await addMovement({ site_id: a.siteId, article_id: articleId, type: "allocate_to_or", qty: a.qty, repair_order_id: a.orId, reason: "Ajout technicien (non prévu)" }, actor);
  }
  const { error } = await supabase.from("or_part_usage").insert({
    repair_order_id: a.orId,
    site_id: a.siteId,
    article_id: articleId,
    movement_id: movementId,
    item_kind: a.kind,
    physical_reference: a.ref.trim() || null,
    designation: a.designation.trim() || null,
    qty_allocated: articleId ? a.qty : 0,
    qty_used: a.qty,
    usage_status: "used",
    unplanned: true,
    confirmed_by: actor.userId,
    confirmed_by_name: actor.name,
    confirmed_at: new Date().toISOString(),
    created_by_name: actor.name,
  });
  if (error) throw error;
  await markOrChanged(a.orId, a.siteId, actor, "usage_unplanned");
}

export async function listSessions(orId: string) {
  const { data } = await supabase.from("work_time_sessions").select("*").eq("repair_order_id", orId).order("started_at", { ascending: false });
  return data ?? [];
}

export async function myOpenSessions(userId: string) {
  const { data } = await supabase.from("work_time_sessions").select("id, repair_order_id, started_at, repair_orders(or_number)").eq("user_id", userId).is("stopped_at", null);
  return data ?? [];
}

export async function startTime(orId: string, siteId: string | null, actor: Actor) {
  const { error } = await supabase.from("work_time_sessions").insert({ repair_order_id: orId, site_id: siteId, user_name: actor.name });
  if (error) throw error;
  await markOrChanged(orId, siteId, actor, "time_start");
}

export async function stopTime(sessionId: string, orId: string, siteId: string | null, actor: Actor) {
  const { error } = await supabase.from("work_time_sessions").update({ stopped_at: new Date().toISOString() }).eq("id", sessionId);
  if (error) throw error;
  await logEvent({ site_id: siteId, entity: "or", entity_id: orId, repair_order_id: orId, action: "time_stop" }, actor);
}

export async function orPartsOverview(orId: string) {
  const orders = await listOrders({ siteId: null, orId });
  const { data: rlines } = await supabase.from("part_receipt_lines").select("*, part_receipts!inner(received_at, site_id)").eq("repair_order_id", orId);
  return { orders, receiptLines: rlines ?? [] };
}

// ---------- Régularisations ----------
export const REGUL_LABELS: Record<string, string> = {
  reception_sans_document: "Réception sans document",
  destination_inconnue: "Destination inconnue",
  stock_negatif: "Stock négatif",
  affectation_non_traitee: "Pièce affectée non pointée",
  piece_endommagee: "Pièce endommagée — retour à traiter",
  piece_a_verifier: "Pièce à vérifier",
  commande_non_enrichie: "Commande non détaillée ancienne",
  travaux_forces: "Travaux terminés forcés",
  reference_a_completer: "Référence à compléter",
  commande_sans_fournisseur: "Commande sans fournisseur",
  reception_sans_commande: "Réception sans commande DDA",
};

export type RegulItem = {
  key: string;
  id: string | null;
  kind: string;
  site_id: string;
  created_at: string;
  supplier: string | null;
  reference: string | null;
  or_id: string | null;
  or_number: string | null;
  plate: string | null;
  comment: string | null;
  source_id: string | null;
};

export async function listRegularizations(siteId: string | null): Promise<RegulItem[]> {
  let q = supabase.from("parts_regularizations").select("*, suppliers(name), repair_orders(or_number)").order("created_at", { ascending: false }).limit(500);
  if (siteId) q = q.eq("site_id", siteId);
  const { data } = await q;
  const rows = data ?? [];
  const closedKeys = new Set(rows.filter((r) => r.status === "closed").map((r) => `${r.kind}:${r.source_id}`));
  const open: RegulItem[] = rows
    .filter((r) => r.status === "open")
    .map((r) => ({
      key: r.id,
      id: r.id,
      kind: r.kind,
      site_id: r.site_id,
      created_at: r.created_at,
      supplier: (r.suppliers as { name: string } | null)?.name ?? null,
      reference: r.physical_reference,
      or_id: r.repair_order_id,
      or_number: (r.repair_orders as { or_number: string | null } | null)?.or_number ?? null,
      plate: r.plate,
      comment: r.comment,
      source_id: r.source_id,
    }));
  const openKeys = new Set(open.map((o) => `${o.kind}:${o.source_id}`));

  // Anomalies calculées en direct
  const computed: RegulItem[] = [];
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  let oq = supabase.from("part_orders").select("id, site_id, created_at, plate, comment, repair_order_id, suppliers(name), repair_orders(or_number), part_order_lines(id)").eq("order_mode", "simplified").eq("status", "ordered").lt("created_at", cutoff).limit(200);
  if (siteId) oq = oq.eq("site_id", siteId);
  for (const o of (await oq).data ?? []) {
    if ((o.part_order_lines as unknown[]).length) continue;
    computed.push({ key: `cmd:${o.id}`, id: null, kind: "commande_non_enrichie", site_id: o.site_id, created_at: o.created_at, supplier: (o.suppliers as { name: string } | null)?.name ?? null, reference: null, or_id: o.repair_order_id, or_number: (o.repair_orders as { or_number: string | null } | null)?.or_number ?? null, plate: o.plate, comment: o.comment, source_id: o.id });
  }
  const { data: done } = await supabase.from("or_work_state").select("repair_order_id").eq("state", "travaux_termines");
  const doneIds = (done ?? []).map((d) => d.repair_order_id);
  if (doneIds.length) {
    let uq = supabase.from("or_part_usage").select("id, site_id, created_at, physical_reference, designation, repair_order_id, repair_orders(or_number)").eq("usage_status", "pending").in("repair_order_id", doneIds);
    if (siteId) uq = uq.eq("site_id", siteId);
    for (const u of (await uq).data ?? []) {
      computed.push({ key: `use:${u.id}`, id: null, kind: "affectation_non_traitee", site_id: u.site_id ?? "", created_at: u.created_at, supplier: null, reference: u.physical_reference ?? u.designation, or_id: u.repair_order_id, or_number: (u.repair_orders as { or_number: string | null } | null)?.or_number ?? null, plate: null, comment: null, source_id: u.id });
    }
  }
  for (const s of await listStock({ siteId })) {
    if (s.available_qty < 0 && !openKeys.has(`stock_negatif:${s.id}`)) {
      computed.push({ key: `neg:${s.id}`, id: null, kind: "stock_negatif", site_id: s.site_id, created_at: s.first_receipt_at ?? new Date().toISOString(), supplier: null, reference: s.physical_reference, or_id: null, or_number: null, plate: null, comment: `Disponible ${s.available_qty}`, source_id: s.id });
    }
  }
  return [...open, ...computed.filter((c) => !closedKeys.has(`${c.kind}:${c.source_id}`) || c.kind === "stock_negatif")].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function closeRegularization(item: RegulItem, comment: string, actor: Actor) {
  const now = new Date().toISOString();
  if (item.id) {
    const { error } = await supabase.from("parts_regularizations").update({ status: "closed", closed_by: actor.userId, closed_by_name: actor.name, closed_at: now, closing_comment: comment || null }).eq("id", item.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("parts_regularizations").insert({ site_id: item.site_id, kind: item.kind, source_id: item.source_id, repair_order_id: item.or_id, physical_reference: item.reference, plate: item.plate, status: "closed", closed_by: actor.userId, closed_by_name: actor.name, closed_at: now, closing_comment: comment || null, created_by_name: actor.name });
    if (error) throw error;
  }
}

/**
 * Expédition d'un retour fournisseur = sortie physique (une seule fois par retour).
 * Chaque ligne avec référence connue sort de la quarantaine si possible, sinon du disponible.
 * Référence introuvable/ambiguë => À régulariser (jamais de mouvement deviné).
 * L'avoir fournisseur reste purement financier : aucun mouvement ici.
 */
export async function shipSupplierReturnStock(returnId: string, actor: Actor): Promise<{ moved: number; regul: number }> {
  const { data: already } = await supabase.from("stock_movements").select("id").eq("part_return_id", returnId).limit(1);
  if (already?.length) return { moved: 0, regul: 0 };
  const { data: ret } = await supabase.from("part_returns").select("site_id, reference").eq("id", returnId).single();
  if (!ret?.site_id) return { moved: 0, regul: 0 };
  const { data: lines } = await supabase.from("part_return_lines").select("reference, quantity, label").eq("return_id", returnId);
  let moved = 0, regul = 0;
  for (const l of lines ?? []) {
    const q = Number(l.quantity ?? 0);
    if (!l.reference || !(q > 0)) continue;
    const hits = await findStockByRef(ret.site_id, l.reference);
    if (hits.length !== 1) {
      await openRegularization({ site_id: ret.site_id, kind: "retour_sans_stock", source_table: "part_returns", source_id: returnId, physical_reference: l.reference, comment: `Retour ${ret.reference} expédié : ${hits.length ? "plusieurs fiches stock" : "aucune fiche stock"} — sortie à décider` }, actor);
      regul++;
      continue;
    }
    const lv = await levelOf(hits[0]!.id);
    const fromQ = lv.quarantine >= q;
    const d = movementDeltas("supplier_return_out", q, { fromQuarantine: fromQ });
    const { error } = await supabase.from("stock_movements").insert({ site_id: ret.site_id, article_id: hits[0]!.id, movement_type: "supplier_return_out", qty: q, ...d, part_return_id: returnId, reason: `Expédition retour ${ret.reference}`, created_by_name: actor.name });
    if (error) throw error;
    moved++;
  }
  return { moved, regul };
}
