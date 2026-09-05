/**
 * Communication par SITE : bibliothèque de visuels, rotation, budget et rayon.
 *
 * Rotation : fréquence FIXE de 7 jours glissants depuis le lancement d'un
 * visuel. Aucun forçage manuel, aucun « support suivant » : le visuel en cours
 * reste diffusé jusqu'au terme de ses 7 jours, puis la file avance.
 */
import { supabase } from "@/integrations/supabase/client";
import { BUCKET } from "./photo";

export const ROTATION_DAYS = 7;
export const DAY_MS = 86_400_000;

export type SiteAdAsset = {
  id: string;
  site_id: string | null;
  title: string;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  active: boolean;
  archived: boolean;
  shown_count: number;
  last_shown_at: string | null;
  started_at: string | null;
  created_at: string;
};

export type CommunicationSettings = {
  site_id: string;
  monthly_budget: number | null;
  radius_km: number | null;
  gbp_url: string | null;
};

/** Un visuel est diffusable s'il est actif, non archivé et rattaché au site. */
export function isEligible(a: SiteAdAsset): boolean {
  return a.active && !a.archived;
}

/** File d'attente : le visuel lancé le plus anciennement passe en premier. */
export function rotationQueue(assets: SiteAdAsset[]): SiteAdAsset[] {
  return assets.filter(isEligible).sort((a, b) => {
    const sa = a.started_at ?? "";
    const sb = b.started_at ?? "";
    if (!!sa !== !!sb) return sa ? -1 : 1;
    if (a.shown_count !== b.shown_count) return a.shown_count - b.shown_count;
    return a.created_at.localeCompare(b.created_at);
  });
}

/**
 * Visuel actuellement diffusé et file des suivants.
 * Une campagne en cours n'est jamais interrompue par la préparation de la
 * suivante : elle ne cède la place qu'au bout de 7 jours pleins.
 */
export function currentRotation(
  assets: SiteAdAsset[],
  now: Date = new Date(),
): { current: SiteAdAsset | null; next: SiteAdAsset[]; endsAt: Date | null } {
  const queue = rotationQueue(assets);
  if (!queue.length) return { current: null, next: [], endsAt: null };

  const running = queue.find(
    (a) => a.started_at && now.getTime() - new Date(a.started_at).getTime() < ROTATION_DAYS * DAY_MS,
  );
  const current = running ?? queue.find((a) => !a.started_at) ?? queue[0]!;
  const endsAt = current.started_at
    ? new Date(new Date(current.started_at).getTime() + ROTATION_DAYS * DAY_MS)
    : null;
  return { current, next: queue.filter((a) => a.id !== current.id), endsAt };
}

export async function fetchSiteAssets(siteId: string): Promise<SiteAdAsset[]> {
  const { data, error } = await supabase
    .from("ad_assets")
    .select("*")
    .eq("site_id", siteId)
    .eq("archived", false)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SiteAdAsset[];
}

/** Ajout d'un visuel : l'image suffit, aucun titre ni date à saisir. */
export async function uploadSiteAsset(opts: { file: File; siteId: string; userId?: string | null }) {
  if (!/^image\//i.test(opts.file.type)) throw new Error("Seules les images sont acceptées.");
  const ext = (opts.file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `ads/${opts.siteId}/${crypto.randomUUID()}.${ext}`;
  const up = await supabase.storage.from(BUCKET).upload(path, opts.file, {
    contentType: opts.file.type,
    upsert: false,
  });
  if (up.error) throw up.error;
  const { error } = await supabase.from("ad_assets").insert({
    title: opts.file.name.replace(/\.[^.]+$/, ""),
    brand: "autre",
    site_id: opts.siteId,
    storage_path: path,
    file_name: opts.file.name,
    mime_type: opts.file.type,
    created_by: opts.userId ?? null,
  } as never);
  if (error) throw error;
}

export async function setAssetActive(id: string, active: boolean) {
  const { error } = await supabase.from("ad_assets").update({ active } as never).eq("id", id);
  if (error) throw error;
}

/** Démarre le compteur de 7 jours d'un visuel s'il n'a jamais été lancé. */
export async function startRotationIfNeeded(asset: SiteAdAsset) {
  if (asset.started_at) return;
  await supabase
    .from("ad_assets")
    .update({
      started_at: new Date().toISOString(),
      last_shown_at: new Date().toISOString(),
      shown_count: asset.shown_count + 1,
    } as never)
    .eq("id", asset.id);
}

export async function fetchSettings(siteId: string): Promise<CommunicationSettings | null> {
  const { data, error } = await supabase
    .from("communication_settings")
    .select("*")
    .eq("site_id", siteId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as CommunicationSettings | null;
}

export async function saveSettings(row: CommunicationSettings, userId: string | null) {
  const { error } = await supabase.from("communication_settings").upsert(
    { ...row, updated_by: userId, updated_at: new Date().toISOString() } as never,
    { onConflict: "site_id" },
  );
  if (error) throw error;
}

export async function assetUrl(storagePath: string, seconds = 3600): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, seconds);
  return data?.signedUrl ?? null;
}
