/**
 * Liste d'approvisionnement multi-fournisseurs : objet métier réutilisable (Commander des pièces, futur Carrosserie).
 * Le document source n'est jamais un fournisseur ; le prix source n'est jamais un PA.
 * La génération des commandes passe uniquement par la RPC generate_procurement_orders (idempotente, verrouillée).
 */
import { supabase } from "@/integrations/supabase/client";
import { isImage } from "@/lib/documents";
import { localDocText } from "@/lib/doc-text.browser";
import { blobToDataUrl, compressImage } from "@/lib/photo";
import { readProcurementDoc } from "@/lib/procurement.functions";
import type { ParsedProcurementList, ProcurementItemType } from "@/lib/procurement-parse";
import { uploadSupplierDoc } from "@/lib/supplier-docs";
import type { Actor } from "@/lib/parts";

export const PROCUREMENT_DOC_TYPE = "liste_approvisionnement";

export type ProcList = {
  id: string; site_id: string; source_document_id: string | null; source_type: string; source_label: string | null;
  requested_or_number: string | null; repair_order_id: string | null; plate: string | null; status: string;
  extraction_route: string | null; warnings: unknown; created_at: string; created_by_name: string | null;
};
export type ProcLine = {
  id: string; list_id: string; position: number; designation: string; reference: string | null; quantity: number;
  source_price_ht: number | null; source_operation: string | null; item_type: ProcurementItemType; supplier_id: string | null;
  generated_order_id: string | null; generated_order_line_id: string | null; status: string; original_text: string | null;
};

/** Lecture du document : texte natif / OCR local d'abord, IA seulement si nécessaire (côté serveur). */
export async function readProcurementFile(file: File): Promise<{ list: ParsedProcurementList; route: string; error: string }> {
  const blob = isImage(file) ? await compressImage(file, 2000, 0.85) : file;
  const dataUrl = await blobToDataUrl(blob);
  const text = await localDocText(file, file.name);
  const r = await readProcurementDoc({ data: { dataUrl, filename: file.name, text } });
  return { list: r.list as ParsedProcurementList, route: r.route, error: r.error };
}

/** Crée la liste (ou rouvre celle déjà créée pour le même document sur le site). */
export async function createProcurementList(
  o: { siteId: string; file: File | null; parsed: ParsedProcurementList; route: string },
  actor: Actor,
): Promise<string> {
  let docId: string | null = null;
  if (o.file) {
    const doc = await uploadSupplierDoc({ file: o.file, extracted: { plate: o.parsed.plate ?? null } as never, siteId: o.siteId, userId: actor.userId, userName: actor.name, docType: PROCUREMENT_DOC_TYPE });
    docId = doc.id;
    const { data: same } = await supabase.from("procurement_lists").select("id").eq("source_document_id", docId).eq("site_id", o.siteId).neq("status", "cancelled").limit(1);
    if (same?.[0]) return same[0].id;
  }
  const { data, error } = await supabase.from("procurement_lists").insert({
    site_id: o.siteId, source_document_id: docId, source_type: o.parsed.source_type, source_label: o.parsed.source_label,
    requested_or_number: o.parsed.or_number, plate: o.parsed.plate, extraction_route: o.route, warnings: o.parsed.warnings as never,
    created_by_name: actor.name,
  }).select("id").single();
  if (error) throw error;
  if (o.parsed.lines.length) {
    const { error: e2 } = await supabase.from("procurement_list_lines").insert(o.parsed.lines.map((l, i) => ({
      list_id: data.id, position: i, designation: l.designation, reference: l.reference, quantity: l.quantity > 0 ? l.quantity : 1,
      source_price_ht: l.source_price_ht, source_operation: l.source_operation, item_type: l.item_type, original_text: l.original_text,
    })));
    if (e2) throw e2;
  }
  if (docId) await supabase.from("inbox_documents").update({ linked_kind: "procurement_list", linked_id: data.id, status: "valide" }).eq("id", docId).is("linked_id", null);
  return data.id;
}

export async function getProcurementList(id: string) {
  const { data: list, error } = await supabase.from("procurement_lists").select("*").eq("id", id).single();
  if (error) throw error;
  const { data: lines } = await supabase.from("procurement_list_lines").select("*").eq("list_id", id).order("position").order("created_at");
  const { data: orders } = await supabase.from("part_orders").select("id, status, supplier_id, created_at, suppliers(name)").eq("procurement_list_id", id).order("created_at");
  let doc: { storage_path: string; file_name: string | null } | null = null;
  if (list.source_document_id) {
    const { data: d } = await supabase.from("inbox_documents").select("storage_path, file_name").eq("id", list.source_document_id).maybeSingle();
    doc = d ?? null;
  }
  return { list: list as ProcList, lines: (lines ?? []) as ProcLine[], orders: orders ?? [], doc };
}

export async function listOpenProcurementLists(siteId: string | null) {
  let q = supabase.from("procurement_lists").select("id, source_type, source_label, requested_or_number, plate, status, created_at").in("status", ["draft", "ready", "partial"]).order("created_at", { ascending: false }).limit(10);
  if (siteId) q = q.eq("site_id", siteId);
  const { data } = await q;
  return data ?? [];
}

export async function updateProcurementList(id: string, patch: { requested_or_number?: string | null; repair_order_id?: string | null; plate?: string | null; status?: string }) {
  const { error } = await supabase.from("procurement_lists").update(patch).eq("id", id);
  if (error) throw error;
}

export async function addProcurementLine(listId: string, position: number) {
  const { error } = await supabase.from("procurement_list_lines").insert({ list_id: listId, position, designation: "Nouvelle ligne", quantity: 1, item_type: "part" });
  if (error) throw error;
}

export async function updateProcurementLine(id: string, patch: Partial<Pick<ProcLine, "designation" | "reference" | "quantity" | "source_price_ht" | "item_type" | "supplier_id">>) {
  const p: Record<string, unknown> = { ...patch };
  if ("supplier_id" in patch) p["status"] = patch.supplier_id ? "ready" : "to_assign";
  const { error } = await supabase.from("procurement_list_lines").update(p).eq("id", id).is("generated_order_id", null);
  if (error) throw error;
}

export async function deleteProcurementLine(id: string) {
  const { error } = await supabase.from("procurement_list_lines").delete().eq("id", id).is("generated_order_id", null);
  if (error) throw error;
}

export async function generateProcurementOrders(listId: string, actor: Actor): Promise<{ orders: { order_id: string; supplier_id: string; lines: number }[]; remaining: number }> {
  const { data, error } = await supabase.rpc("generate_procurement_orders", { _list: listId, _user_name: actor.name });
  if (error) {
    if (/OR_REQUIRED/.test(error.message)) throw new Error("N° d'OR obligatoire avant génération.");
    throw error;
  }
  return data as never;
}
