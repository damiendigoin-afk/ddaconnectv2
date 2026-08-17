import { supabase } from "@/integrations/supabase/client";
import { BUCKET } from "./photo";

/** Catégories documentaires d'une mission (dossier complet du véhicule / sinistre). */
export const DOC_CATEGORIES = [
  { key: "expertise", label: "Expertise" },
  { key: "sinistre", label: "Sinistre" },
  { key: "vehicule", label: "Véhicule" },
  { key: "client", label: "Client" },
  { key: "photos", label: "Photos" },
  { key: "pieces", label: "Pièces / BL" },
  { key: "or", label: "OR" },
  { key: "factures", label: "Devis / Factures" },
  { key: "administratif", label: "Administratif" },
  { key: "autres", label: "Autres" },
] as const;

export type DocCategory = (typeof DOC_CATEGORIES)[number]["key"];

export function categoryLabel(key: string | null): string {
  return DOC_CATEGORIES.find((c) => c.key === key)?.label ?? "Autres";
}

/** Extensions métier acceptées. Tout exécutable ou script est refusé. */
export const ALLOWED_EXTENSIONS = [
  "pdf", "jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "tif", "tiff",
  "doc", "docx", "xls", "xlsx", "csv", "txt", "rtf", "odt", "ods", "eml", "msg",
] as const;

export const DOC_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.gif,.tif,.tiff,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.odt,.ods,.eml,.msg";

const BLOCKED = new Set([
  "exe","msi","bat","cmd","com","scr","pif","cpl","jar","js","mjs","vbs","vbe","ps1","psm1",
  "sh","bash","apk","app","dmg","deb","rpm","dll","so","py","php","html","htm","svg","zip","rar","7z",
]);

export const MAX_DOC_SIZE = 25 * 1024 * 1024;

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

/** Retourne null si le fichier est acceptable, sinon un message expliquant le refus. */
export function rejectReason(file: File): string | null {
  const ext = extensionOf(file.name);
  if (!ext) return `« ${file.name} » n'a pas d'extension reconnue : renomme le fichier avec son extension (.pdf, .jpg…).`;
  if (BLOCKED.has(ext)) return `Les fichiers .${ext} ne sont pas autorisés pour des raisons de sécurité. Convertis le document en PDF ou en image.`;
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext))
    return `Le format .${ext} n'est pas pris en charge. Formats acceptés : PDF, images, Word, Excel, CSV, e-mails.`;
  if (file.size > MAX_DOC_SIZE)
    return `« ${file.name} » dépasse 25 Mo. Compresse le document ou envoie-le en plusieurs parties.`;
  return null;
}

export function isImage(file: File): boolean {
  return file.type.startsWith("image/") || ["jpg","jpeg","png","heic","heif","webp","gif","tif","tiff"].includes(extensionOf(file.name));
}

export type DocAuthor = { userId?: string | null; userName?: string | null };

/**
 * Dépose un document dans le dossier documentaire d'une mission carrosserie.
 * Aucune suppression automatique : ces pièces sont définitives.
 */
export async function uploadCaseDocument(opts: {
  caseId: string;
  file: File;
  category: DocCategory | string;
  docType?: string;
  label?: string | null;
  origin?: string | null;
  author?: DocAuthor;
}) {
  const reason = rejectReason(opts.file);
  if (reason) throw new Error(reason);
  const ext = extensionOf(opts.file.name);
  const path = `cases/${opts.caseId}/${crypto.randomUUID()}.${ext}`;
  const up = await supabase.storage.from(BUCKET).upload(path, opts.file, {
    contentType: opts.file.type || "application/octet-stream",
    upsert: false,
  });
  if (up.error) throw up.error;

  const { data, error } = await supabase
    .from("bodyshop_documents")
    .insert({
      case_id: opts.caseId,
      doc_type: opts.docType ?? opts.category,
      category: opts.category,
      label: opts.label ?? null,
      file_name: opts.file.name,
      origin: opts.origin ?? "ajout_manuel",
      storage_path: path,
      mime_type: opts.file.type || null,
      file_size: opts.file.size,
      created_by: opts.author?.userId ?? null,
      created_by_name: opts.author?.userName ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** URL signée de consultation / téléchargement d'un document. */
export async function docUrl(storagePath: string, seconds = 3600): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, seconds);
  return data?.signedUrl ?? null;
}

export async function openDoc(storagePath: string) {
  const url = await docUrl(storagePath);
  if (url) window.open(url, "_blank", "noopener");
}
