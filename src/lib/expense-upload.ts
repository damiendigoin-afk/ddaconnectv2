/** Justificatifs de notes de frais : envoi dans le bucket média existant. */
import { supabase } from "@/integrations/supabase/client";
import { BUCKET, compressImage } from "@/lib/photo";

export async function uploadReceipt(file: Blob, filename: string, userId: string): Promise<{ path: string; mime: string }> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(filename);
  const body = isPdf ? file : await compressImage(file, 1800, 0.85);
  const mime = isPdf ? "application/pdf" : "image/jpeg";
  const path = `notes-frais/${userId}/${crypto.randomUUID()}.${isPdf ? "pdf" : "jpg"}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType: mime, upsert: false });
  if (error) throw error;
  return { path, mime };
}

export async function receiptUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("lecture impossible"));
    reader.readAsDataURL(blob);
  });
}
