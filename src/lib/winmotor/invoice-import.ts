/** Import navigateur des exports factures WinMotor : lots idempotents par hash, envoi par paquets à la base. */
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_VAT, MAPPING_VERSION, decodeBuffer, parseExport, rawRowsToCsv, sanitizeDeep, type ImportKind, type ParseResult } from "./invoices";

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function loadVatTable(): Promise<Record<string, number>> {
  const { data } = await supabase.from("winmotor_vat_codes").select("code, rate");
  if (!data?.length) return DEFAULT_VAT;
  return Object.fromEntries(data.map((r) => [r.code, Number(r.rate)]));
}

export type Prepared = { file: File; hash: string; parsed: ParseResult; existing: { id: string; status: string; created_at: string } | null };

export async function prepareFile(file: File, siteId: string, kind: ImportKind | null): Promise<Prepared> {
  const buf = await file.arrayBuffer();
  const hash = await sha256Hex(buf);
  const { text, encoding } = decodeBuffer(buf);
  const parsed = parseExport(text, kind, encoding, await loadVatTable());
  const { data } = await supabase.from("winmotor_import_batches").select("id, status, created_at").eq("site_id", siteId).eq("import_type", parsed.kind).eq("file_hash", hash).maybeSingle();
  return { file, hash, parsed, existing: data ?? null };
}

const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export async function runImport(p: Prepared, siteId: string, actorName: string, onProgress: (done: number, total: number) => void, opts: { reprocess?: boolean } = {}) {
  const reprocess = !!opts.reprocess && p.existing?.status === "done";
  if (p.existing?.status === "done" && !reprocess) return { alreadyImported: true as const, batchId: p.existing.id };
  let storageWarning: string | null = null;
  let batchId = reprocess ? null : (p.existing?.id ?? null);
  if (!batchId) {
    // Retraitement : nouveau lot traçé (le lot d'origine est conservé), mêmes factures mises à jour par n° de facture.
    const fileHash = reprocess ? `${p.hash}#retraitement-${Date.now()}` : p.hash;
    const { data, error } = await supabase
      .from("winmotor_import_batches")
      .insert({ site_id: siteId, import_type: p.parsed.kind, file_name: reprocess ? `${p.file.name} (retraitement mapping ${MAPPING_VERSION})` : p.file.name, file_hash: fileHash, file_size: p.file.size, encoding: p.parsed.encoding, date_min: p.parsed.dateMin, date_max: p.parsed.dateMax, rows_total: p.parsed.rowsTotal, rows_rejected: p.parsed.rejects.length, rows_recovered: p.parsed.recovered, created_by_name: actorName, ...(reprocess ? { report: { reprocessOf: p.existing!.id, mappingVersion: MAPPING_VERSION } as never } : {}) })
      .select("id")
      .single();
    if (error) throw error;
    batchId = data.id;
    // Fichier source brut conservé dans le stockage (non bloquant).
    const path = `winmotor-imports/${siteId}/${p.hash}-${p.file.name.replace(/[^\w.-]/g, "_")}`;
    const up = await supabase.storage.from("dda-media").upload(path, p.file, { upsert: true });
    if (!up.error) await supabase.from("winmotor_import_batches").update({ storage_path: path }).eq("id", batchId);
    else storageWarning = `Fichier source non archivé (${up.error.message}) — l'import continue.`;
    for (const c of chunk(p.parsed.rejects, 500)) {
      await supabase.from("winmotor_import_rejects").insert(c.map((r) => ({ ...r, batch_id: batchId!, site_id: siteId })));
    }
  }
  const tot = { created: 0, updated: 0, unchanged: 0, lines: 0 };
  const cleaned = { n: 0 };
  if (p.parsed.kind === "headers") {
    const parts = chunk(p.parsed.headerRows, 200);
    for (let i = 0; i < parts.length; i++) {
      const { data, error } = await supabase.rpc("wm_import_headers", { _batch: batchId, _site: siteId, _rows: sanitizeDeep(parts[i], cleaned) as never });
      if (error) { await failBatch(batchId, error.message, i * 200); throw error; }
      const r = data as { created: number; updated: number; unchanged: number };
      tot.created += r.created; tot.updated += r.updated; tot.unchanged += r.unchanged;
      onProgress(Math.min((i + 1) * 200, p.parsed.headerRows.length), p.parsed.headerRows.length);
    }
  } else {
    // Paquets par nombre de lignes (une facture n'est jamais coupée entre deux paquets).
    const parts: (typeof p.parsed.invoices)[] = [];
    let cur: typeof p.parsed.invoices = [];
    let n = 0;
    for (const inv of p.parsed.invoices) {
      cur.push(inv); n += inv.lines.length;
      if (n >= 1500) { parts.push(cur); cur = []; n = 0; }
    }
    if (cur.length) parts.push(cur);
    let done = 0;
    for (const part of parts) {
      const { data, error } = await supabase.rpc("wm_import_details", { _batch: batchId, _site: siteId, _invoices: sanitizeDeep(part, cleaned) as never });
      if (error) { await failBatch(batchId, error.message, done); throw error; }
      const r = data as { created: number; updated: number; unchanged: number; lines: number };
      tot.created += r.created; tot.updated += r.updated; tot.unchanged += r.unchanged; tot.lines += r.lines;
      done += part.length;
      onProgress(done, p.parsed.invoices.length);
    }
  }
  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const { data: link } = await supabase.rpc("wm_link_orders", { _site: siteId, _mirror_since: since });
  await supabase
    .from("winmotor_import_batches")
    .update({ status: "done", completed_at: new Date().toISOString(), invoices_seen: p.parsed.kind === "headers" ? p.parsed.headerRows.length : p.parsed.invoices.length, invoices_created: tot.created, invoices_updated: tot.updated, invoices_unchanged: tot.unchanged, lines_inserted: tot.lines, report: { orLinks: link, missing: p.parsed.missing, map: p.parsed.map, duplicateInvoiceRows: p.parsed.duplicateInvoiceRows, sanitizedChars: p.parsed.sanitizedChars + cleaned.n } as never })
    .eq("id", batchId);
  return { alreadyImported: false as const, batchId, ...tot, orLinks: link, storageWarning };
}

async function failBatch(id: string, message: string, at: number) {
  await supabase.from("winmotor_import_batches").update({ status: "failed", report: { error: message, stoppedAt: at } as never }).eq("id", id);
}

export async function listBatches() {
  const { data } = await supabase.from("winmotor_import_batches").select("*").order("created_at", { ascending: false }).limit(50);
  return data ?? [];
}

export async function listRejects(batchId: string) {
  const { data } = await supabase.from("winmotor_import_rejects").select("line_no, reason, raw_text").eq("batch_id", batchId).order("line_no").limit(200);
  return data ?? [];
}

/**
 * Retraitement historique d'un lot Entêtes terminé, SANS réupload : relit header_raw des factures du lot
 * (vrais en-têtes WinMotor), réapplique le mapping actuel et met à jour les mêmes factures (site + n°).
 * Lot d'origine conservé (période corrigée, trace dans son report) + nouveau lot « retraitement » tracé.
 */
export async function reprocessHeadersFromRaw(orig: { id: string; site_id: string; file_name: string; file_hash: string; report: unknown }, actorName: string, onProgress: (done: number, total: number, phase: string) => void) {
  const rows: Record<string, string>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("winmotor_invoices").select("header_raw").eq("header_batch_id", orig.id).order("invoice_number").range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) if (r.header_raw && typeof r.header_raw === "object") rows.push(r.header_raw as Record<string, string>);
    onProgress(rows.length, rows.length, "lecture");
    if (!data || data.length < 1000) break;
  }
  if (!rows.length) throw new Error("Aucune donnée brute conservée pour ce lot.");
  const parsed = parseExport(rawRowsToCsv(rows), "headers", "base (header_raw)", await loadVatTable());
  if (parsed.missing.length) throw new Error(`Colonnes introuvables : ${parsed.missing.join(", ")}`);
  const { data: nb, error: e1 } = await supabase.from("winmotor_import_batches").insert({ site_id: orig.site_id, import_type: "headers", file_name: `${orig.file_name} (retraitement mapping ${MAPPING_VERSION}, données conservées)`, file_hash: `${orig.file_hash}#raw-${Date.now()}`, encoding: parsed.encoding, date_min: parsed.dateMin, date_max: parsed.dateMax, rows_total: parsed.rowsTotal, rows_rejected: parsed.rejects.length, created_by_name: actorName, report: { reprocessOf: orig.id, source: "header_raw", mappingVersion: MAPPING_VERSION } as never }).select("id").single();
  if (e1) throw e1;
  const batchId = nb.id;
  const tot = { created: 0, updated: 0, unchanged: 0 };
  const cleaned = { n: 0 };
  const parts = chunk(parsed.headerRows, 200);
  for (let i = 0; i < parts.length; i++) {
    const { data, error } = await supabase.rpc("wm_import_headers", { _batch: batchId, _site: orig.site_id, _rows: sanitizeDeep(parts[i], cleaned) as never });
    if (error) { await failBatch(batchId, error.message, i * 200); throw error; }
    const r = data as { created: number; updated: number; unchanged: number };
    tot.created += r.created; tot.updated += r.updated; tot.unchanged += r.unchanged;
    onProgress(Math.min((i + 1) * 200, parsed.headerRows.length), parsed.headerRows.length, "mise à jour");
  }
  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const { data: link } = await supabase.rpc("wm_link_orders", { _site: orig.site_id, _mirror_since: since });
  await supabase.from("winmotor_import_batches").update({ status: "done", completed_at: new Date().toISOString(), invoices_seen: parsed.headerRows.length, invoices_created: tot.created, invoices_updated: tot.updated, invoices_unchanged: tot.unchanged, report: { reprocessOf: orig.id, source: "header_raw", mappingVersion: MAPPING_VERSION, orLinks: link, map: parsed.map, sanitizedChars: parsed.sanitizedChars + cleaned.n } as never }).eq("id", batchId);
  const prev = orig.report && typeof orig.report === "object" ? (orig.report as Record<string, unknown>) : {};
  await supabase.from("winmotor_import_batches").update({ date_min: parsed.dateMin, date_max: parsed.dateMax, report: { ...prev, reprocessedBy: batchId, reprocessedAt: new Date().toISOString() } as never }).eq("id", orig.id);
  return { batchId, ...tot, dateMin: parsed.dateMin, dateMax: parsed.dateMax };
}
