/**
 * BL et factures fournisseur : dépôt (photo, image, PDF), lecture OCR tolérante,
 * validation manuelle obligatoire puis suivi d'état.
 * Réutilise la table `inbox_documents` existante : aucune nouvelle table.
 */
import { supabase } from "@/integrations/supabase/client";
import { extensionOf, rejectReason } from "@/lib/documents";

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
};

export type InvoiceExtract = {
  doc_kind?: string | null;
  supplier?: string | null;
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
}): Promise<SupplierDoc> {
  const reason = rejectReason(opts.file);
  if (reason) throw new Error(reason);
  const path = `fournisseurs/${crypto.randomUUID()}.${extensionOf(opts.file.name)}`;
  const up = await supabase.storage.from(BUCKET).upload(path, opts.file, {
    contentType: opts.file.type || "application/octet-stream",
    upsert: false,
  });
  if (up.error) throw up.error;

  const { data, error } = await supabase
    .from("inbox_documents")
    .insert({
      doc_type: SUPPLIER_DOC_TYPE,
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
