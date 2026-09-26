/** Lectures factures WinMotor + rapprochement (navigateur, RLS). Paginé, jamais d'import massif en mémoire. */
import { supabase } from "@/integrations/supabase/client";
import type { Equivalences } from "./reconcile";

export const INVOICE_LIST = "id, site_id, invoice_number, doc_kind, invoice_date, or_number, repair_order_id, client_name, billed_client_name, client_no, billed_client_no, plate, total_ht, total_ttc, lines_net_ht, lines_hours, has_header, has_detail, ref_vehicle_id, customer_id";

export async function invoicesForVehicle(v: { id: string; registration_normalized: string | null; vin_normalized: string | null }, page = 0) {
  const ors = [`ref_vehicle_id.eq.${v.id}`];
  if (v.vin_normalized) ors.push(`vin_normalized.eq.${v.vin_normalized}`);
  if (v.registration_normalized) ors.push(`plate_normalized.eq.${v.registration_normalized}`);
  const { data } = await supabase.from("winmotor_invoices").select(INVOICE_LIST).or(ors.join(",")).order("invoice_date", { ascending: false, nullsFirst: false }).range(page * 20, page * 20 + 19);
  return data ?? [];
}

export async function invoicesForCustomer(customerId: string, page = 0) {
  const { data } = await supabase.from("winmotor_invoices").select(INVOICE_LIST).or(`customer_id.eq.${customerId},billed_customer_id.eq.${customerId}`).order("invoice_date", { ascending: false, nullsFirst: false }).range(page * 20, page * 20 + 19);
  return data ?? [];
}

/** Résumé court des lignes (hors en-têtes de forfait) pour la timeline. */
export async function lineSummaries(invoiceIds: string[]) {
  if (!invoiceIds.length) return new Map<string, string>();
  const { data } = await supabase.from("winmotor_invoice_lines").select("invoice_id, designation, line_kind").in("invoice_id", invoiceIds).eq("active", true).limit(1000);
  const m = new Map<string, string[]>();
  for (const l of data ?? []) {
    if (!l.designation) continue;
    const arr = m.get(l.invoice_id) ?? [];
    if (arr.length < 5) arr.push(l.line_kind === "package_header" ? `[${l.designation}]` : l.designation);
    m.set(l.invoice_id, arr);
  }
  return new Map([...m].map(([k, v]) => [k, v.join(" · ")]));
}

export async function getInvoice(id: string) {
  const { data, error } = await supabase.from("winmotor_invoices").select("*").eq("id", id).single();
  if (error) throw error;
  const { data: lines } = await supabase.from("winmotor_invoice_lines").select("*").eq("invoice_id", id).eq("active", true).order("source_seq");
  return { ...data, lines: lines ?? [] };
}

export async function searchInvoices(term: string, limit = 8) {
  const t = term.trim();
  if (t.length < 3) return [];
  const { data } = await supabase.from("winmotor_invoices").select("id, site_id, invoice_number, invoice_date, or_number, plate, client_name, total_ttc").eq("invoice_number", t).limit(limit);
  return data ?? [];
}

/** Liste des OR facturés (clé site + n° OR), récents d'abord, paginée. */
export async function listBilledOrs(siteId: string | null, page = 0, q = "") {
  let query = supabase.from("winmotor_invoices").select("site_id, or_number, repair_order_id, invoice_number, invoice_date, plate, total_ttc, doc_kind").not("or_number", "is", null).order("invoice_date", { ascending: false, nullsFirst: false }).range(page * 60, page * 60 + 59);
  if (siteId) query = query.eq("site_id", siteId);
  if (q.trim()) query = query.or(`or_number.eq.${q.trim()},invoice_number.eq.${q.trim()},plate_normalized.eq.${q.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")}`);
  const { data } = await query;
  const groups = new Map<string, { site_id: string; or_number: string; repair_order_id: string | null; plate: string | null; last: string | null; invoices: string[]; ttc: number }>();
  for (const r of data ?? []) {
    const k = `${r.site_id}|${r.or_number}`;
    const g = groups.get(k) ?? { site_id: r.site_id, or_number: r.or_number!, repair_order_id: r.repair_order_id, plate: r.plate, last: r.invoice_date, invoices: [], ttc: 0 };
    g.invoices.push(r.invoice_number);
    g.ttc += Number(r.total_ttc ?? 0);
    g.repair_order_id = g.repair_order_id ?? r.repair_order_id;
    groups.set(k, g);
  }
  return [...groups.values()];
}

export async function orBillingBundle(siteId: string, orNumber: string) {
  const { data: invoices } = await supabase.from("winmotor_invoices").select("*").eq("site_id", siteId).eq("or_number", orNumber).order("invoice_date");
  const ids = (invoices ?? []).map((i) => i.id);
  const { data: lines } = ids.length ? await supabase.from("winmotor_invoice_lines").select("*").in("invoice_id", ids).eq("active", true).order("source_seq") : { data: [] };
  const orId = (invoices ?? []).find((i) => i.repair_order_id)?.repair_order_id ?? null;
  const lineIds = (lines ?? []).map((l) => l.id);
  const [usages, links, sessions, stockLinks] = await Promise.all([
    orId ? supabase.from("or_part_usage").select("*").eq("repair_order_id", orId).then((r) => r.data ?? []) : Promise.resolve([]),
    lineIds.length ? supabase.from("winmotor_reconciliation_links").select("*").in("invoice_line_id", lineIds).then((r) => r.data ?? []) : Promise.resolve([]),
    orId ? supabase.from("work_time_sessions").select("started_at, stopped_at").eq("repair_order_id", orId).then((r) => r.data ?? []) : Promise.resolve([]),
    orId ? supabase.from("part_orders").select("id, status, created_at, suppliers(name), part_order_lines(physical_reference, qty_ordered, qty_received)").eq("repair_order_id", orId).then((r) => r.data ?? []) : Promise.resolve([]),
  ]);
  return { invoices: invoices ?? [], lines: lines ?? [], orId, usages, links, sessions, orders: stockLinks };
}

export async function loadEquivalences(): Promise<Equivalences> {
  const { data } = await supabase.from("winmotor_ref_equivalences").select("wm_ref_normalized, dda_ref_normalized").limit(5000);
  const m: Equivalences = new Map();
  for (const r of data ?? []) {
    if (!m.has(r.wm_ref_normalized)) m.set(r.wm_ref_normalized, new Set());
    m.get(r.wm_ref_normalized)!.add(r.dda_ref_normalized);
  }
  return m;
}

export async function linkUsage(lineId: string, usageId: string, qty: number, method: "auto" | "manual", rule: string | null, actorName: string) {
  const { data, error } = await supabase.rpc("wm_link_usage", { _line: lineId, _usage: usageId, _qty: qty, _method: method, _rule: rule ?? "", _user_name: actorName });
  if (error) throw error;
  return data;
}

export async function unlink(linkId: string, actorName: string) {
  const { error } = await supabase.rpc("wm_unlink", { _link: linkId, _user_name: actorName });
  if (error) throw error;
}

export async function storeSale(lineId: string, articleId: string, qty: number, actorName: string) {
  const { error } = await supabase.rpc("wm_store_sale", { _line: lineId, _article: articleId, _qty: qty, _user_name: actorName });
  if (error) throw error;
}

export async function rememberEquivalence(wmRef: string, ddaRef: string, actorName: string) {
  const a = wmRef.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const b = ddaRef.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!a || !b || a === b) return;
  const { data } = await supabase.from("winmotor_ref_equivalences").select("id, confirmations").eq("wm_ref_normalized", a).eq("dda_ref_normalized", b).maybeSingle();
  if (data) await supabase.from("winmotor_ref_equivalences").update({ confirmations: data.confirmations + 1, updated_at: new Date().toISOString() }).eq("id", data.id);
  else await supabase.from("winmotor_ref_equivalences").insert({ wm_ref_normalized: a, dda_ref_normalized: b, created_by_name: actorName });
}
