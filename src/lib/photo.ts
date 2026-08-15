import { supabase } from "@/integrations/supabase/client";

export const BUCKET = "dda-media";

export async function compressImage(file: File, maxSide = 1500, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  return blob ?? file;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export type MediaLinks = {
  inspection_id?: string | null;
  inspection_point_id?: string | null;
  observation_id?: string | null;
  repair_order_id?: string | null;
  label?: string | null;
};

export async function uploadPhoto(file: File, folder: string, links: MediaLinks) {
  const blob = await compressImage(file);
  const path = `${folder}/${crypto.randomUUID()}.jpg`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (upErr) throw upErr;

  const { data, error } = await supabase
    .from("media")
    .insert({ ...links, media_type: "photo", storage_path: path })
    .select()
    .single();
  if (error) throw error;
  return data;
}

const urlCache = new Map<string, string>();

export async function mediaUrl(path: string): Promise<string> {
  const cached = urlCache.get(path);
  if (cached) return cached;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 6);
  const url = data?.signedUrl ?? "";
  if (url) urlCache.set(path, url);
  return url;
}

export async function deleteMedia(id: string, path: string) {
  await supabase.storage.from(BUCKET).remove([path]);
  await supabase.from("media").delete().eq("id", id);
}