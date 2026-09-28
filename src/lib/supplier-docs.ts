import { mailFullyImported, operationalMails } from "@/lib/supplier-mail-filter";
/**
 * validation manuelle obligatoire puis suivi d'état.
 * Réutilise la table `inbox_documents` existante : aucune nouvelle table.
 */
import { supabase } from "@/integrations/supabase/client";
import { extensionOf, rejectReason } from "@/lib/documents";
import { dedupeDocs } from "@/lib/receipt-lines";

export const SUPPLIER_DOC_TYPE = "facture_fournisseur";
const BUCKET = "dda-media";

export const DOC_STATUSES = [
  { key: "non_traite", label: "Non traité" },
  { key: "a_verifier", label: "À vérifier" },
  { key: "valide", label: "Validé" },
  { key: "lie_or", label: "Lié OR" },
  { key: "archive", label: "Archivé" },
] as const;

export type DocStatus = (typeof DOC_STATUSES)[number]["key"];

export function statusLabel(status: string): string {
  return DOC_STATUSES.find((s) => s.key === status)?.label ?? status;
}

export type InvoiceLine = {
  reference: string | null;
  label: string | null;
  quantity: number | null;
  unit_price: number | null;
  discount_pct: number | null;
  amount: number | null;
  delay?: string | null;
};

export type SupplierInfo = { address?: string | null; postal_code?: string | null; city?: string | null; phone?: string | null; email?: string | null; website?: string | null; siret?: string | null; vat_number?: string | null };

export type InvoiceExtract = {
  or_number?: string | null;
  document_number?: string | null;
  document_date?: string | null;
  doc_kind?: string | null;
  supplier?: string | null;
  /** Coordonnées de l'émetteur lues sur le document (préremplissage de la fiche). */
  supplier_info?: SupplierInfo | null;
  /** Fiche fournisseur rattachée au document (dès l'import). */
  supplier_id?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
  delivery_note_number?: string | null;
  customer_or_site?: string | null;
  order_reference?: string | null;
  plate?: string | null;
  lines?: InvoiceLine[];
  total_ht?: number | null;
  vat_amount?: number | null;
  total_ttc?: number | null;
  handwritten_notes?: string | null;
};

export type SupplierDoc = {
  id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  status: string;
  note: string | null;
  plate: string | null;
  customer_name: string | null;
  linked_kind: string | null;
  linked_id: string | null;
  site_id: string | null;
  created_at: string;
  extracted: InvoiceExtract;
};

const DOC_COLS = "id,file_name,storage_path,mime_type,status,note,plate,customer_name,linked_kind,linked_id,site_id,created_at,extracted";

function toExtract(value: unknown): InvoiceExtract {
  return value && typeof value === "object" ? (value as InvoiceExtract) : {};
}

export async function fetchSupplierDocs(siteId?: string | null): Promise<SupplierDoc[]> {
  let q = supabase
    .from("inbox_documents")
    .select(
      "id,file_name,storage_path,mime_type,status,note,plate,customer_name,linked_kind,linked_id,site_id,created_at,extracted",
    )
    .eq("doc_type", SUPPLIER_DOC_TYPE)
    .order("created_at", { ascending: false })
    .limit(200);
  if (siteId) q = q.eq("site_id", siteId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((d) => ({ ...d, extracted: toExtract(d.extracted) }));
}

/** Dépôt du fichier + création de la fiche en « Non traité ». */
export async function uploadSupplierDoc(opts: {
  file: File;
  extracted: InvoiceExtract;
  siteId?: string | null;
  userId?: string | null;
  userName?: string | null;
  /** Type de document : BL/facture par défaut ; « bon_commande_fournisseur » pour une commande. */
  docType?: string;
  /** Traçabilité : e-mail et pièce jointe d'origine (anti-doublon). */
  sourceEmailId?: string | null;
  sourceEmailAttachmentId?: string | null;
}): Promise<SupplierDoc> {
  const reason = rejectReason(opts.file);
  if (reason) throw new Error(reason);
  // Anti-doublon : même fichier (SHA-256) sur le même site → document existant réutilisé.
  const hashBuf = await crypto.subtle.digest("SHA-256", await opts.file.arrayBuffer());
  const contentHash = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  let dq = supabase.from("inbox_documents").select(DOC_COLS).eq("content_hash", contentHash).eq("doc_type", opts.docType ?? SUPPLIER_DOC_TYPE).neq("status", "doublon").order("created_at", { ascending: false }).limit(1);
  dq = opts.siteId ? dq.eq("site_id", opts.siteId) : dq.is("site_id", null);
  const { data: same } = await dq;
  if (same?.[0]) return { ...same[0], extracted: toExtract(same[0].extracted) };
  const path = `fournisseurs/${crypto.randomUUID()}.${extensionOf(opts.file.name)}`;
  const up = await supabase.storage.from(BUCKET).upload(path, opts.file, {
    contentType: opts.file.type || "application/octet-stream",
    upsert: false,
  });
  if (up.error) throw up.error;

  const { data, error } = await supabase
    .from("inbox_documents")
    .insert({
      doc_type: opts.docType ?? SUPPLIER_DOC_TYPE,
      file_name: opts.file.name,
      file_size: opts.file.size,
      mime_type: opts.file.type || null,
      storage_path: path,
      status: "non_traite",
      plate: opts.extracted.plate ?? null,
      customer_name: opts.extracted.supplier ?? null,
      note: opts.extracted.handwritten_notes ?? null,
      extracted: opts.extracted as never,
      site_id: opts.siteId ?? null,
      created_by: opts.userId ?? null,
      created_by_name: opts.userName ?? null,
      source_email_id: opts.sourceEmailId ?? null,
      source_email_attachment_id: opts.sourceEmailAttachmentId ?? null,
      content_hash: contentHash,
    })
    .select(
      "id,file_name,storage_path,mime_type,status,note,plate,customer_name,linked_kind,linked_id,site_id,created_at,extracted",
    )
    .single();
  if (error) throw error;
  return { ...data, extracted: toExtract(data.extracted) };
}

/** Enregistrement de la validation manuelle : rien n'est créé sans passage par cet écran. */
export async function updateSupplierDoc(
  id: string,
  patch: { status?: DocStatus; note?: string | null; plate?: string | null; extracted?: InvoiceExtract },
): Promise<void> {
  const { error } = await supabase
    .from("inbox_documents")
    .update({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.plate !== undefined ? { plate: patch.plate } : {}),
      ...(patch.extracted ? { extracted: patch.extracted as never } : {}),
    })
    .eq("id", id);
  if (error) throw error;
}

/** Rattachement à un OR existant : bascule l'état en « Lié OR ». */
export async function linkSupplierDocToOrder(id: string, orderId: string): Promise<void> {
  const { error } = await supabase
    .from("inbox_documents")
    .update({ linked_kind: "repair_order", linked_id: orderId, status: "lie_or" })
    .eq("id", id);
  if (error) throw error;
}

/** Recherche d'un OR par numéro pour proposer un rattachement. */
export async function findOrderCandidates(term: string) {
  const t = term.trim();
  if (t.length < 3) return [];
  const { data } = await supabase
    .from("repair_orders")
    .select("id,or_number,or_date")
    .ilike("or_number", `%${t}%`)
    .limit(10);
  return data ?? [];
}

export async function supplierDocUrl(storagePath: string): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
  return data?.signedUrl ?? null;
}

export const ORDER_DOC_TYPE = "bon_commande_fournisseur";

/** Documents fournisseur encore à traiter (non validés, non liés, non archivés) — file existante réutilisée. */
export async function fetchPendingSupplierDocs(siteId: string | null): Promise<SupplierDoc[]> {
  let q = supabase
    .from("inbox_documents")
    .select("id,file_name,storage_path,mime_type,status,note,plate,customer_name,linked_kind,linked_id,site_id,created_at,extracted")
    .eq("doc_type", SUPPLIER_DOC_TYPE)
    .in("status", ["non_traite", "a_verifier"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (siteId) q = q.or(`site_id.eq.${siteId},site_id.is.null`);
  const { data, error } = await q;
  if (error) throw error;
  // Une seule carte par document strictement identique (statut « doublon » exclu par le filtre de statut).
  return dedupeDocs((data ?? []).map((d) => ({ ...d, extracted: toExtract(d.extracted) })));
}

export type SupplierMail = { id: string; sent_at: string; from_name: string | null; from_address: string | null; to_addresses: string[] | null; cc_addresses: string[] | null; body_text: string | null; snippet: string | null; subject: string | null; detected_plate: string | null; site_id: string | null; effective_site_id: string | null; files: string[]; attachments: MailAttachment[] };
export type MailAttachment = { id: string; filename: string; mime_type: string | null; storage_path: string | null; imported_doc_id: string | null };

/** Documents opérationnels reçus par e-mail (BL/factures/avoirs), ouverts, 60 derniers jours, site effectif. */
export async function fetchSupplierMails(siteId: string | null, sites: { id: string; code: string | null }[] = []): Promise<SupplierMail[]> {
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  const { data } = await supabase
    .from("emails")
    .select("id, sent_at, from_name, from_address, to_addresses, cc_addresses, body_text, snippet, subject, detected_plate, site_id, triage_status, email_attachments(id, filename, mime_type, storage_path)")
    .in("category", ["fournisseur", "magasin", "bl"])
    .eq("has_attachments", true)
    .gte("sent_at", since)
    .order("sent_at", { ascending: false })
    .limit(300);
  type Row = Omit<SupplierMail, "files" | "effective_site_id" | "attachments"> & { triage_status: string | null; email_attachments: Omit<MailAttachment, "imported_doc_id">[] | null };
  const raw = (data ?? []) as unknown as Row[];
  const attIds = raw.flatMap((m) => (m.email_attachments ?? []).map((a) => a.id));
  const imported = new Map<string, string>();
  for (let i = 0; i < attIds.length; i += 200) {
    const { data: docs } = await supabase.from("inbox_documents").select("id, source_email_attachment_id").in("source_email_attachment_id", attIds.slice(i, i + 200));
    for (const d of docs ?? []) if (d.source_email_attachment_id) imported.set(d.source_email_attachment_id, d.id);
  }
  const rows = raw.map((m) => ({ ...m, files: (m.email_attachments ?? []).map((a) => a.filename) }));
  return operationalMails(rows, sites, siteId)
    .map((m) => {
      const docFiles = new Set(m.files);
      const attachments = (m.email_attachments ?? [])
        .filter((a) => docFiles.has(a.filename))
        .map((a) => ({ ...a, imported_doc_id: imported.get(a.id) ?? null }));
      return { ...m, attachments };
    })
    // Mail entièrement ajouté à DDA : il sort de la file (même si le statut n'a pas pu être écrit).
    .filter((m) => !mailFullyImported(m.attachments))
    .slice(0, 50);
}

export async function getSupplierDoc(id: string): Promise<SupplierDoc | null> {
  const { data } = await supabase
    .from("inbox_documents")
    .select("id,file_name,storage_path,mime_type,status,note,plate,customer_name,linked_kind,linked_id,site_id,created_at,extracted")
    .eq("id", id)
    .maybeSingle();
  return data ? { ...data, extracted: toExtract(data.extracted) } : null;
}

/** Ajoute à DDA une pièce jointe e-mail : fichier réel → OCR → document tracé, anti-doublon. */
export async function importEmailAttachment(opts: {
  mail: SupplierMail;
  attachment: MailAttachment;
  siteId: string | null;
  userId?: string | null;
  userName?: string | null;
  fetchFile: (attachmentId: string) => Promise<{ ok: true; filename: string; mime: string; base64: string } | { ok: false; reason: string; message: string }>;
  read: (file: File) => Promise<{ file: File; extracted: InvoiceExtract; warning?: string | null }>;
}): Promise<{ doc: SupplierDoc | null; existing: string | null; warning?: string | null; error?: string }> {
  const { data: dup } = await supabase.from("inbox_documents").select("id").eq("source_email_attachment_id", opts.attachment.id).maybeSingle();
  if (dup) return { doc: null, existing: dup.id };
  const f = await opts.fetchFile(opts.attachment.id);
  if (!f.ok) return { doc: null, existing: null, error: f.message };
  const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
  const file = new File([bytes], f.filename, { type: f.mime });
  const r = await opts.read(file);
  const doc = await uploadSupplierDoc({
    file: r.file,
    extracted: r.extracted,
    siteId: opts.siteId,
    userId: opts.userId ?? null,
    userName: opts.userName ?? null,
    sourceEmailId: opts.mail.id,
    sourceEmailAttachmentId: opts.attachment.id,
  });
  const others = opts.mail.attachments.map((a) => (a.id === opts.attachment.id ? { ...a, imported_doc_id: doc.id } : a));
  if (mailFullyImported(others)) {
    await supabase.from("emails").update({ triage_status: "traite" }).eq("id", opts.mail.id);
  }
  return { doc, existing: null, warning: r.warning ?? null };
}
