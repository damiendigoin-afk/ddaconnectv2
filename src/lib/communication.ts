/**
 * Bibliothèque de supports publicitaires (module Communication).
 * Rotation linéaire simple : chacun son tour, sans pondération.
 */
import { supabase } from "@/integrations/supabase/client";
import { BUCKET } from "./photo";

export type AdBrand = "renault" | "dacia" | "autre";

export const AD_BRANDS: { key: AdBrand; label: string }[] = [
  { key: "renault", label: "Renault" },
  { key: "dacia", label: "Dacia" },
  { key: "autre", label: "Autre" },
];

export type AdAsset = {
  id: string;
  title: string;
  brand: string;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  starts_on: string | null;
  ends_on: string | null;
  active: boolean;
  archived: boolean;
  shown_count: number;
  last_shown_at: string | null;
  created_at: string;
};

export async function fetchAdAssets(includeArchived = false): Promise<AdAsset[]> {
  let q = supabase.from("ad_assets").select("*").order("created_at", { ascending: false });
  if (!includeArchived) q = q.eq("archived", false);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AdAsset[];
}

/** Un support est diffusable s'il est actif, non archivé et dans sa fenêtre de dates. */
export function isRunning(a: AdAsset, today = new Date().toISOString().slice(0, 10)): boolean {
  if (!a.active || a.archived) return false;
  if (a.starts_on && a.starts_on > today) return false;
  if (a.ends_on && a.ends_on < today) return false;
  return true;
}

/** Rotation linéaire : le support le moins diffusé, puis le plus anciennement diffusé. */
export function nextInRotation(assets: AdAsset[], today?: string): AdAsset | null {
  const running = assets.filter((a) => isRunning(a, today));
  if (!running.length) return null;
  return [...running].sort((a, b) => {
    if (a.shown_count !== b.shown_count) return a.shown_count - b.shown_count;
    const la = a.last_shown_at ?? "";
    const lb = b.last_shown_at ?? "";
    if (la !== lb) return la.localeCompare(lb);
    return a.created_at.localeCompare(b.created_at);
  })[0]!;
}

export async function markShown(asset: AdAsset) {
  await supabase
    .from("ad_assets")
    .update({ shown_count: asset.shown_count + 1, last_shown_at: new Date().toISOString() })
    .eq("id", asset.id);
}

export async function uploadAdAsset(opts: {
  file: File;
  title: string;
  brand: AdBrand;
  startsOn?: string | null;
  endsOn?: string | null;
  userId?: string | null;
  userName?: string | null;
}) {
  const ext = (opts.file.name.split(".").pop() || "bin").toLowerCase();
  const path = `ads/${crypto.randomUUID()}.${ext}`;
  const up = await supabase.storage.from(BUCKET).upload(path, opts.file, {
    contentType: opts.file.type || "application/octet-stream",
    upsert: false,
  });
  if (up.error) throw up.error;
  const { error } = await supabase.from("ad_assets").insert({
    title: opts.title,
    brand: opts.brand,
    storage_path: path,
    file_name: opts.file.name,
    mime_type: opts.file.type || null,
    starts_on: opts.startsOn || null,
    ends_on: opts.endsOn || null,
    created_by: opts.userId ?? null,
    created_by_name: opts.userName ?? null,
  });
  if (error) throw error;
}

export async function updateAdAsset(id: string, patch: Partial<Omit<AdAsset, "id">>) {
  const { error } = await supabase.from("ad_assets").update(patch).eq("id", id);
  if (error) throw error;
}

export async function adUrl(storagePath: string, seconds = 3600): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, seconds);
  return data?.signedUrl ?? null;
}
