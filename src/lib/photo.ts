import { supabase } from "@/integrations/supabase/client";

export const BUCKET = "dda-media";

type Decoded = { source: CanvasImageSource; width: number; height: number; close?: () => void };

async function decodeImage(file: Blob, maxSide?: number): Promise<Decoded | null> {
  // Un seul décodage, directement en taille réduite : sur les capteurs 50 Mpx
  // (Pixel 7), allouer le bitmap plein format fait planter l'onglet.
  try {
    const opts: ImageBitmapOptions | undefined = maxSide
      ? { resizeWidth: maxSide, resizeQuality: "low" }
      : undefined;
    const bitmap = await createImageBitmap(file, opts as ImageBitmapOptions);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close?.(),
    };
  } catch {
    // ignore, fallback ci-dessous
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode"));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

export async function compressImage(file: Blob, maxSide = 1500, quality = 0.82): Promise<Blob> {
  const decoded = await decodeImage(file, maxSide);
  if (!decoded || !decoded.width || !decoded.height) return file;
  let canvas: HTMLCanvasElement | null = null;
  try {
    const scale = Math.min(1, maxSide / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const cv = document.createElement("canvas");
    canvas = cv;
    cv.width = width;
    cv.height = height;
    const ctx = cv.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(decoded.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      cv.toBlob(resolve, "image/jpeg", quality),
    );
    return blob ?? file;
  } catch {
    return file;
  } finally {
    decoded.close?.();
    // Libère immédiatement la mémoire du canvas (critique sur mobile).
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
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

export async function uploadPhoto(
  file: Blob,
  folder: string,
  links: MediaLinks,
  opts?: { alreadyCompressed?: boolean },
) {
  // Deux représentations : haute définition conservée pour consultation détaillée,
  // miniature légère pour les listes et rapports.
  const hd = opts?.alreadyCompressed ? file : await compressImage(file, 2000, 0.9);
  // La miniature est dérivée du HD (déjà décodé/allégé) pour éviter de re-décoder
  // une photo d'origine très lourde sur mobile.
  const thumb = await compressImage(hd, 700, 0.72);
  const id = crypto.randomUUID();
  const path = `${folder}/${id}.jpg`;
  const thumbPath = `${folder}/${id}_thumb.jpg`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, hd, { contentType: "image/jpeg", upsert: false });
  if (upErr) throw upErr;
  const { error: thErr } = await supabase.storage
    .from(BUCKET)
    .upload(thumbPath, thumb, { contentType: "image/jpeg", upsert: true });

  const { data, error } = await supabase
    .from("media")
    .insert({
      ...links,
      media_type: "photo",
      storage_path: path,
      thumb_path: thErr ? null : thumbPath,
    })
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
  await supabase.storage.from(BUCKET).remove([path, path.replace(/\.jpg$/, "_thumb.jpg")]);
  await supabase.from("media").delete().eq("id", id);
}