/**
 * Garages proposés au site public DDA Pneus et suggestion du plus proche.
 * Règles pures : la position n'est qu'une APPROXIMATION facultative
 * (géolocalisation navigateur après action, ou commune/code postal) ; jamais
 * d'IP. Sans information exploitable : Castillon. Le client choisit toujours.
 */
import { z } from "zod";

export type WebSiteKey = "castillon" | "lalinde";
/** Clé publique => code interne `sites.code` (aucun identifiant interne exposé). */
export const WEB_SITES: { key: WebSiteKey; code: string; label: string }[] = [
  { key: "castillon", code: "castillon", label: "Garage Castillon (Castels et Bézenac)" },
  { key: "lalinde", code: "dda", label: "Damien Digoin Automobile (Lalinde)" },
];
export const DEFAULT_WEB_SITE: WebSiteKey = "castillon";
export const webSiteKey = z.enum(["castillon", "lalinde"]);

export type SiteChoiceMethod = "default" | "geolocation" | "postal" | "manual";
export type GeoPoint = { lat: number; lng: number };
export type SiteWithCoords = { key: WebSiteKey; lat: number | null; lng: number | null };

export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Au-delà, la position est jugée sans rapport avec les garages : Castillon par défaut. */
export const MAX_SUGGESTION_KM = 150;

export function suggestSite(
  sites: SiteWithCoords[],
  point: GeoPoint | null,
  method: Exclude<SiteChoiceMethod, "default" | "manual">,
): { suggested: WebSiteKey; method: SiteChoiceMethod; distancesKm: Partial<Record<WebSiteKey, number>> } {
  const usable = sites.filter((s): s is SiteWithCoords & { lat: number; lng: number } => s.lat != null && s.lng != null);
  if (!point || usable.length < sites.length || usable.length === 0)
    return { suggested: DEFAULT_WEB_SITE, method: "default", distancesKm: {} };
  const distancesKm: Partial<Record<WebSiteKey, number>> = {};
  let best: { key: WebSiteKey; d: number } | null = null;
  for (const s of usable) {
    const d = distanceKm(point, { lat: s.lat, lng: s.lng });
    distancesKm[s.key] = Math.round(d);
    // Égalité => ordre de WEB_SITES (Castillon d'abord), déterministe.
    if (!best || d < best.d) best = { key: s.key, d };
  }
  if (!best || best.d > MAX_SUGGESTION_KM) return { suggested: DEFAULT_WEB_SITE, method: "default", distancesKm };
  return { suggested: best.key, method, distancesKm };
}

export const siteSuggestionInput = z.union([
  z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).strict(),
  z.object({ postalCode: z.string().regex(/^\d{5}$/) }).strict(),
  z.object({ commune: z.string().trim().min(2).max(80).regex(/^[\p{L}' -]+$/u) }).strict(),
  z.object({}).strict(),
]);
export type SiteSuggestionInput = z.infer<typeof siteSuggestionInput>;

/** Arrondi à ~1 km : la position précise n'est ni utile ni conservée. */
export function coarse(p: GeoPoint): GeoPoint {
  return { lat: Math.round(p.lat * 100) / 100, lng: Math.round(p.lng * 100) / 100 };
}
