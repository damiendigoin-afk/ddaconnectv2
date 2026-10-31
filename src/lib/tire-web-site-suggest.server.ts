/**
 * Suggestion du garage le plus proche (POST /api/public/tyres/site-suggestion).
 * Entrée facultative : position navigateur (après action du client), code postal
 * ou commune (géocodés par geo.api.gouv.fr, centre de commune). Jamais d'IP.
 * Rien n'est conservé ; défaut Castillon ; le client choisit toujours.
 */
import { corsHeaders, originAllowed, type WebQuoteConfig } from "./tire-web-api";
import { clientIp, err, json, readBounded, sha } from "./tire-web-facade.server";
import {
  DEFAULT_WEB_SITE,
  WEB_SITES,
  coarse,
  siteSuggestionInput,
  suggestSite,
  type GeoPoint,
  type SiteWithCoords,
} from "./tire-web-sites";

export type SuggestDeps = {
  loadConfig: () => Promise<WebQuoteConfig | null>;
  quotaHit: (bucket: string, windowSeconds: number, limit: number) => Promise<boolean>;
  loadSites: () => Promise<SiteWithCoords[]>;
  geocode: (q: { postalCode?: string; commune?: string }) => Promise<GeoPoint | null>;
  now: () => Date;
};

const unavailable = () => err("service_unavailable", "Service momentanément indisponible.");

export async function handleSuggestPost(req: Request, deps: SuggestDeps): Promise<Response> {
  const origin = req.headers.get("origin");
  let cfg: WebQuoteConfig | null;
  try {
    cfg = await deps.loadConfig();
  } catch {
    return json(503, unavailable());
  }
  const cors = corsHeaders(origin, cfg?.allowed_origins ?? null);
  if (!cfg?.enabled) return json(503, unavailable(), cors);
  if (!originAllowed(origin, cfg.allowed_origins)) return json(403, err("origin_not_allowed", "Origine non autorisée."), cors);
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json"))
    return json(415, err("unsupported_media_type", "Content-Type application/json requis."), cors);
  const text = await readBounded(req, 512);
  if (text == null) return json(413, err("payload_too_large", "Requête trop volumineuse."), cors);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json(400, err("invalid_json", "JSON invalide."), cors);
  }
  const parsed = siteSuggestionInput.safeParse(raw);
  if (!parsed.success) return json(400, err("invalid_request", "Paramètres invalides."), cors);
  const input = parsed.data as { latitude?: number; longitude?: number; postalCode?: string; commune?: string };

  try {
    const ip = await sha(`${deps.now().toISOString().slice(0, 10)}|${clientIp(req)}`);
    if (!(await deps.quotaHit(`site-ip:${ip}`, 600, 30)))
      return json(429, err("rate_limited", "Trop de demandes, réessayez plus tard."), cors, { "Retry-After": "600" });
  } catch {
    return json(503, unavailable(), cors);
  }

  const sitesOut = WEB_SITES.map((s) => ({ key: s.key, label: s.label }));
  let sites: SiteWithCoords[];
  try {
    sites = await deps.loadSites();
  } catch {
    return json(200, { sites: sitesOut, suggested: DEFAULT_WEB_SITE, method: "default", approximate: true, distancesKm: {} }, cors);
  }
  let point: GeoPoint | null = null;
  let method: "geolocation" | "postal" = "postal";
  if (input.latitude != null && input.longitude != null) {
    point = coarse({ lat: input.latitude, lng: input.longitude });
    method = "geolocation";
  } else if (input.postalCode || input.commune) {
    try {
      point = await deps.geocode(input.postalCode ? { postalCode: input.postalCode } : { commune: input.commune! });
    } catch {
      point = null;
    }
  }
  const r = suggestSite(sites, point, method);
  return json(200, { sites: sitesOut, suggested: r.suggested, method: r.method, approximate: true, distancesKm: r.distancesKm }, cors);
}

export async function realSuggestDeps(): Promise<SuggestDeps> {
  const { realAppointmentDeps } = await import("./tire-web-appointment.server");
  const base = await realAppointmentDeps();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return {
    loadConfig: base.loadConfig,
    quotaHit: base.quotaHit,
    now: base.now,
    loadSites: async () => {
      const { data, error } = await supabaseAdmin
        .from("sites")
        .select("code, latitude, longitude")
        .in("code", WEB_SITES.map((w) => w.code))
        .eq("active", true);
      if (error) throw new Error("sites");
      return WEB_SITES.map((w) => {
        const row = (data ?? []).find((d) => d.code === w.code);
        return { key: w.key, lat: row?.latitude ?? null, lng: row?.longitude ?? null };
      });
    },
    geocode: async (q) => {
      const params = q.postalCode
        ? `codePostal=${encodeURIComponent(q.postalCode)}`
        : `nom=${encodeURIComponent(q.commune ?? "")}&boost=population`;
      const res = await fetch(`https://geo.api.gouv.fr/communes?${params}&fields=centre&limit=1`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const arr = (await res.json()) as { centre?: { coordinates?: [number, number] } }[];
      const c = arr[0]?.centre?.coordinates;
      return c ? { lat: c[1], lng: c[0] } : null;
    },
  };
}
