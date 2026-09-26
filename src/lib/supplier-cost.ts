/**
 * Coût réel fournisseur : relie chaque ligne de facture contrôlée à sa ligne de réception
 * et revalorise l'article (PAMP, dernier PA). AUCUN mouvement de stock n'est créé ici :
 * une facture ou un avoir fournisseur ne modifie jamais les quantités physiques.
 * Les prix commande / réception (unit_cost_provisional) / facture restent conservés.
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizeRef } from "@/lib/parts-rules";
import { levelOf, logEvent, openRegularization, type Actor } from "@/lib/parts";
import type { SupplierDoc } from "@/lib/supplier-docs";
import {
  isCreditDoc,
  lineGapAbs,
  matchReceiptLine,
  pampAfterCostCorrection,
  supplierLineKey,
  withinTolerance,
  type ReceiptCandidate,
} from "@/lib/supplier-cost-rules";

export type CostLine = {
  id: string;
  line_key: string;
  doc_kind: string;
  physical_reference: string | null;
  designation: string | null;
  qty: number | null;
  unit_price_ht: number | null;
  receipt_line_id: string | null;
  reference_cost: number | null;
  gap_abs: number | null;
  status: string;
  applied_cost: number | null;
  pamp_before: number | null;
  pamp_after: number | null;
  comment: string | null;
};

export const COST_STATUS_LABEL: Record<string, string> = {
  applied: "Coût réel appliqué",
  price_alert: "Écart prix > 1 € — à valider (FO)",
  unmatched: "À rapprocher",
  credit_financial: "Avoir — financier uniquement",
  ignored: "Ignorée",
};

export async function fetchCostLines(docId: string): Promise<CostLine[]> {
  const { data, error } = await supabase
    .from("supplier_cost_lines")
    .select("id,line_key,doc_kind,physical_reference,designation,qty,unit_price_ht,receipt_line_id,reference_cost,gap_abs,status,applied_cost,pamp_before,pamp_after,comment")
    .eq("document_id", docId)
    .order("line_key");
  if (error) throw error;
  return (data ?? []) as CostLine[];
}

type RL = {
  id: string; article_id: string | null; qty_received: number; unit_cost_provisional: number | null;
  unit_cost_real: number | null; unit_cost_real_doc_id: string | null; order_line_id: string | null;
  part_receipts: { site_id: string; supplier_id: string | null; source_document_id: string | null; received_at: string; suppliers: { name: string | null } | null } | null;
  stock_articles: { reference_normalized: string } | null;
};
const RL_SELECT = "id,article_id,qty_received,unit_cost_provisional,unit_cost_real,unit_cost_real_doc_id,order_line_id,part_receipts(site_id,supplier_id,source_document_id,received_at,suppliers(name)),stock_articles(reference_normalized)";

/** Lignes de réception candidates (même site, mêmes références) — lecture seule. */
export async function receiptCandidates(siteId: string, refs: string[]): Promise<RL[]> {
  const norm = [...new Set(refs.filter(Boolean).map(normalizeRef))];
  if (!norm.length) return [];
  const { data: arts } = await supabase.from("stock_articles").select("id").eq("site_id", siteId).in("reference_normalized", norm);
  const ids = (arts ?? []).map((a) => a.id);
  if (!ids.length) return [];
  const { data } = await supabase.from("part_receipt_lines").select(RL_SELECT).in("article_id", ids).gt("qty_received", 0).order("created_at", { ascending: false }).limit(200);
  return ((data ?? []) as unknown as RL[]).filter((l) => l.part_receipts?.site_id === siteId);
}

async function referenceCost(rl: RL): Promise<number | null> {
  if (rl.unit_cost_provisional != null) return Number(rl.unit_cost_provisional);
  if (!rl.order_line_id) return null;
  const { data } = await supabase.from("part_order_lines").select("*").eq("id", rl.order_line_id).maybeSingle();
  const v = (data as Record<string, unknown> | null)?.["unit_price_expected"] ?? (data as Record<string, unknown> | null)?.["unit_price"];
  return v == null ? null : Number(v);
}

/** Revalorisation effective (idempotente : même coût déjà appliqué → rien). */
async function applyCost(costLineId: string, rl: RL, newCost: number, docId: string, invoiceDate: string | null, actor: Actor) {
  if (!rl.article_id) throw new Error("Ligne de réception sans article.");
  const previous = rl.unit_cost_real != null ? Number(rl.unit_cost_real) : null;
  if (previous === newCost && rl.unit_cost_real_doc_id === docId) {
    await supabase.from("supplier_cost_lines").update({ status: "applied", applied_cost: newCost, updated_at: new Date().toISOString() }).eq("id", costLineId);
    return;
  }
  const { data: art } = await supabase.from("stock_articles").select("id,site_id,pamp,last_purchase_at").eq("id", rl.article_id).single();
  const lv = await levelOf(rl.article_id);
  const onHand = lv.available + lv.allocated + lv.quarantine;
  const pampBefore = art?.pamp != null ? Number(art.pamp) : null;
  const oldCost = previous ?? (rl.unit_cost_provisional != null ? Number(rl.unit_cost_provisional) : pampBefore);
  const pampAfter = pampAfterCostCorrection(onHand, pampBefore, Number(rl.qty_received), oldCost, newCost);

  // Dernier PA : seulement si cette réception est la plus récente de l'article.
  const { data: latest } = await supabase.from("part_receipt_lines").select("id,part_receipts(received_at)").eq("article_id", rl.article_id).gt("qty_received", 0).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const isLatest = !latest || latest.id === rl.id;
  const artPatch: Record<string, unknown> = { pamp: pampAfter, updated_at: new Date().toISOString() };
  if (isLatest) {
    artPatch.last_purchase_price = newCost;
    artPatch.last_purchase_at = invoiceDate ? new Date(invoiceDate).toISOString() : rl.part_receipts?.received_at ?? new Date().toISOString();
    if (rl.part_receipts?.supplier_id) artPatch.last_supplier_id = rl.part_receipts.supplier_id;
  }
  const { error: e1 } = await supabase.from("stock_articles").update(artPatch as never).eq("id", rl.article_id);
  if (e1) throw e1;
  const { error: e2 } = await supabase.from("part_receipt_lines").update({ unit_cost_real: newCost, unit_cost_real_at: new Date().toISOString(), unit_cost_real_doc_id: docId }).eq("id", rl.id);
  if (e2) throw e2;
  await supabase.from("supplier_cost_lines").update({
    status: "applied", receipt_line_id: rl.id, article_id: rl.article_id, applied_cost: newCost,
    pamp_before: pampBefore, pamp_after: pampAfter, applied_at: new Date().toISOString(),
    validated_by_name: actor.name, updated_at: new Date().toISOString(),
  }).eq("id", costLineId);
  await logEvent({ site_id: art?.site_id ?? null, entity: "stock_article", entity_id: rl.article_id, action: "real_cost_applied", detail: { receipt_line_id: rl.id, document_id: docId, old_cost: oldCost, new_cost: newCost, pamp_before: pampBefore, pamp_after: pampAfter } }, actor);
}

/**
 * Contrôle des coûts d'une facture fournisseur validée. Rejouable sans dérive :
 * clé (document, rang+référence) unique, coût déjà appliqué ignoré.
 */
export async function controlSupplierInvoiceCosts(doc: SupplierDoc, actor: Actor): Promise<{ applied: number; alerts: number; unmatched: number; credit: number }> {
  if (!doc.site_id) throw new Error("Document sans site : choisissez d'abord la société concernée.");
  const siteId = doc.site_id;
  const ex = doc.extracted;
  const credit = isCreditDoc(ex.doc_kind, ex.total_ht);
  const lines = (ex.lines ?? []).map((l, i) => ({ ...l, key: supplierLineKey(i, l.reference) }));
  const existing = new Map((await fetchCostLines(doc.id)).map((c) => [c.line_key, c]));
  const cands = credit ? [] : await receiptCandidates(siteId, lines.map((l) => l.reference ?? ""));
  const res = { applied: 0, alerts: 0, unmatched: 0, credit: 0 };

  for (const l of lines) {
    const qty = l.quantity != null ? Number(l.quantity) : null;
    const unit = l.unit_price != null ? Number(l.unit_price) * (1 - (Number(l.discount_pct ?? 0) / 100)) : qty && l.amount != null ? Number(l.amount) / qty : null;
    const prev = existing.get(l.key);
    if (prev?.status === "ignored") continue;
    if (prev?.status === "applied" && prev.applied_cost != null && unit != null && Math.abs(Number(prev.applied_cost) - unit) < 0.00005) { res.applied++; continue; }

    const base = {
      site_id: siteId, document_id: doc.id, line_key: l.key, doc_kind: credit ? "credit" : "invoice",
      supplier_name: ex.supplier ?? null, physical_reference: l.reference ?? null, designation: l.label ?? null,
      qty, unit_price_ht: unit != null ? Math.round(unit * 10000) / 10000 : null, created_by_name: actor.name, updated_at: new Date().toISOString(),
    };

    if (credit) {
      await supabase.from("supplier_cost_lines").upsert({ ...base, status: "credit_financial" }, { onConflict: "document_id,line_key" });
      res.credit++; continue;
    }

    // Ligne déjà reliée (automatiquement ou manuellement) : on la conserve.
    let rlId = prev?.receipt_line_id ?? null;
    if (!rlId && qty != null && unit != null) {
      const pool: ReceiptCandidate[] = cands.map((c) => ({
        id: c.id, qty_received: Number(c.qty_received), reference_normalized: c.stock_articles?.reference_normalized ?? null,
        source_document_id: c.part_receipts?.source_document_id ?? null, supplier_name: c.part_receipts?.suppliers?.name ?? null,
        already_costed_by_other_doc: c.unit_cost_real_doc_id != null && c.unit_cost_real_doc_id !== doc.id,
      }));
      rlId = matchReceiptLine({ reference: l.reference, qty }, doc.id, ex.supplier ?? null, pool);
    }
    const rl = rlId ? cands.find((c) => c.id === rlId) ?? (await fetchRL(rlId)) : null;

    if (!rl || unit == null || qty == null) {
      const { data } = await supabase.from("supplier_cost_lines").upsert({ ...base, status: "unmatched", receipt_line_id: null }, { onConflict: "document_id,line_key" }).select("id").single();
      if (prev?.status !== "unmatched") {
        await openRegularization({ site_id: siteId, kind: "cout_fournisseur_a_rapprocher", source_table: "supplier_cost_lines", source_id: data?.id ?? null, physical_reference: l.reference ?? null, comment: `Facture ${ex.invoice_number ?? doc.file_name} : ligne non reliée de façon certaine à une réception.` }, actor);
      }
      res.unmatched++; continue;
    }

    const refCost = await referenceCost(rl);
    const gap = lineGapAbs(qty, unit, refCost);
    const { data: row, error } = await supabase.from("supplier_cost_lines").upsert({ ...base, receipt_line_id: rl.id, article_id: rl.article_id, reference_cost: refCost, gap_abs: gap, status: withinTolerance(gap) ? "applied" : "price_alert" }, { onConflict: "document_id,line_key" }).select("id").single();
    if (error) throw error;
    if (withinTolerance(gap)) {
      await applyCost(row.id, rl, Math.round(unit * 10000) / 10000, doc.id, ex.invoice_date ?? null, actor);
      res.applied++;
    } else {
      if (prev?.status !== "price_alert") {
        await openRegularization({ site_id: siteId, kind: "ecart_prix_fournisseur", source_table: "supplier_cost_lines", source_id: row.id, supplier_id: rl.part_receipts?.supplier_id ?? null, physical_reference: l.reference ?? null, comment: `Alerte FO — écart ${gap} € (facture ${unit} € vs ${refCost} € attendu × ${qty}).` }, actor);
      }
      res.alerts++;
    }
  }
  return res;
}

async function fetchRL(id: string): Promise<RL | null> {
  const { data } = await supabase.from("part_receipt_lines").select(RL_SELECT).eq("id", id).maybeSingle();
  return (data as unknown as RL) ?? null;
}

/** Validation manuelle d'un écart prix (> 1 €) : le prix facture devient le coût réel. */
export async function validatePriceAlert(costLineId: string, docId: string, invoiceDate: string | null, actor: Actor) {
  const { data: c } = await supabase.from("supplier_cost_lines").select("receipt_line_id,unit_price_ht").eq("id", costLineId).single();
  if (!c?.receipt_line_id || c.unit_price_ht == null) throw new Error("Ligne incomplète.");
  const rl = await fetchRL(c.receipt_line_id);
  if (!rl) throw new Error("Réception introuvable.");
  await applyCost(costLineId, rl, Number(c.unit_price_ht), docId, invoiceDate, actor);
  await supabase.from("parts_regularizations").update({ status: "closed" }).eq("source_table", "supplier_cost_lines").eq("source_id", costLineId);
}

/** Rattachement manuel d'une ligne « À rapprocher » à une réception choisie par l'utilisateur. */
export async function linkCostLine(costLineId: string, receiptLineId: string, doc: SupplierDoc, actor: Actor) {
  const { data: c } = await supabase.from("supplier_cost_lines").select("qty,unit_price_ht").eq("id", costLineId).single();
  const rl = await fetchRL(receiptLineId);
  if (!rl || c?.unit_price_ht == null) throw new Error("Rattachement impossible.");
  if (rl.unit_cost_real_doc_id && rl.unit_cost_real_doc_id !== doc.id) throw new Error("Cette réception est déjà valorisée par une autre facture.");
  const refCost = await referenceCost(rl);
  const gap = lineGapAbs(Number(c.qty ?? rl.qty_received), Number(c.unit_price_ht), refCost);
  await supabase.from("supplier_cost_lines").update({ receipt_line_id: rl.id, article_id: rl.article_id, reference_cost: refCost, gap_abs: gap, status: withinTolerance(gap) ? "applied" : "price_alert", updated_at: new Date().toISOString() }).eq("id", costLineId);
  await supabase.from("parts_regularizations").update({ status: "closed" }).eq("source_table", "supplier_cost_lines").eq("source_id", costLineId).eq("kind", "cout_fournisseur_a_rapprocher");
  if (withinTolerance(gap)) await applyCost(costLineId, rl, Number(c.unit_price_ht), doc.id, doc.extracted.invoice_date ?? null, actor);
  else await openRegularization({ site_id: doc.site_id!, kind: "ecart_prix_fournisseur", source_table: "supplier_cost_lines", source_id: costLineId, physical_reference: null, comment: `Alerte FO — écart ${gap} € après rattachement manuel.` }, actor);
}
