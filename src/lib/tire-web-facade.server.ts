/**
 * Façade serveur du devis pneus site web (POST /api/public/tyres/quotes).
 *
 * Ordre : corps borné → configuration (désactivé => 503) → origine → validation
 * stricte → quotas persistants atomiques (RPC) → cache/déduplication → collecte
 * Top prix (runTopPrice, même moteur que l'écran interne) sous délai global.
 * Aucune écriture métier, aucune donnée personnelle, aucune commande.
 */
import type { TopPriceEngine, TopPriceSources, TopPriceResult } from "./tire-top-price-core";
import {
  WEB_QUOTE_MAX_BODY_BYTES,
  buildWebQuoteResponse,
  corsHeaders,
  webQuoteInput,
  webQuoteKey,
  webReadiness,
  type WebQuoteConfig,
  type WebQuoteInput,
  type WebQuoteResponse,
} from "./tire-web-api";

export type FacadeDeps = {
  loadConfig: () => Promise<WebQuoteConfig | null>;
  districashConfigured: (siteId: string) => Promise<boolean>;
  quotaHit: (bucket: string, windowSeconds: number, limit: number) => Promise<boolean>;
  loadEngine: () => Promise<TopPriceEngine>;
  sources: (input: WebQuoteInput, siteId: string) => TopPriceSources;
  runTopPrice: (args: Parameters<typeof import("./tire-top-price-core").runTopPrice>[0], s: TopPriceSources) => Promise<TopPriceResult>;
  now: () => Date;
  uuid: () => string;
  timeoutMs?: number;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 100;
type CacheEntry = { at: number; body: WebQuoteResponse };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<{ status: number; body: unknown }>>();

export function resetWebQuoteCache() {
  cache.clear();
  inflight.clear();
}

function json(status: number, body: unknown, headers: Record<string, string> = {}, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers, ...extra },
  });
}
const err = (code: string, message: string) => ({ error: { code, message } });

async function sha(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

function clientIp(req: Request): string {
  return (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim();
}

async function readBounded(req: Request): Promise<string | null> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > WEB_QUOTE_MAX_BODY_BYTES) return null;
  const text = await req.text();
  return new TextEncoder().encode(text).length > WEB_QUOTE_MAX_BODY_BYTES ? null : text;
}

export async function handleWebQuoteOptions(req: Request, deps: Pick<FacadeDeps, "loadConfig">): Promise<Response> {
  const origin = req.headers.get("origin");
  let allowed: string | null = null;
  try {
    allowed = (await deps.loadConfig())?.allowed_origin ?? null;
  } catch {
    allowed = null;
  }
  const h = corsHeaders(origin, allowed);
  return new Response(null, { status: origin && origin === allowed ? 204 : 403, headers: h });
}

export async function handleWebQuotePost(req: Request, deps: FacadeDeps): Promise<Response> {
  const origin = req.headers.get("origin");

  // 1. Configuration : tout défaut => service indisponible (jamais de faux succès).
  let cfg: WebQuoteConfig | null;
  try {
    cfg = await deps.loadConfig();
  } catch {
    return json(503, err("service_unavailable", "Devis en ligne momentanément indisponible."));
  }
  const cors = corsHeaders(origin, cfg?.allowed_origin ?? null);
  if (!cfg?.enabled) return json(503, err("service_unavailable", "Devis en ligne momentanément indisponible."), cors);
  let dcOk: boolean | null = null;
  try {
    dcOk = cfg.site_id ? await deps.districashConfigured(cfg.site_id) : null;
  } catch {
    dcOk = null;
  }
  if (!webReadiness(cfg, dcOk).ok || !cfg.site_id)
    return json(503, err("service_unavailable", "Devis en ligne momentanément indisponible."), cors);

  // 2. Origine autorisée (CORS n'est pas un anti-abus : les quotas suivent).
  if (origin !== cfg.allowed_origin) return json(403, err("origin_not_allowed", "Origine non autorisée."), cors);

  // 3. Corps borné et validation stricte.
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json"))
    return json(415, err("unsupported_media_type", "Content-Type application/json requis."), cors);
  const text = await readBounded(req);
  if (text == null) return json(413, err("payload_too_large", "Requête trop volumineuse."), cors);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json(400, err("invalid_json", "JSON invalide."), cors);
  }
  const parsed = webQuoteInput.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "body")))];
    return json(400, { ...err("invalid_request", "Paramètres invalides."), fields }, cors);
  }
  const input = parsed.data;

  // 4. Quotas persistants et atomiques, avant toute collecte (échec => fermé).
  try {
    const day = deps.now().toISOString().slice(0, 10);
    const ipKey = `ip:${await sha(`${day}|${clientIp(req)}`)}`;
    const ipOk = await deps.quotaHit(ipKey, 600, cfg.quota_ip_per_10min);
    const globalOk = ipOk ? await deps.quotaHit("global", 3600, cfg.quota_global_per_hour) : false;
    if (!ipOk || !globalOk)
      return json(429, err("rate_limited", "Trop de demandes, réessayez plus tard."), cors, { "Retry-After": ipOk ? "3600" : "600" });
  } catch {
    return json(503, err("service_unavailable", "Devis en ligne momentanément indisponible."), cors);
  }

  // 5. Cache borné (critères pneus uniquement) + déduplication des recherches.
  const key = webQuoteKey(input);
  const hit = cache.get(key);
  if (hit && deps.now().getTime() - hit.at < CACHE_TTL_MS) return json(200, hit.body, cors);
  let job = inflight.get(key);
  if (!job) {
    job = compute(input, cfg.site_id, deps).finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  const r = await job;
  return json(r.status, r.body, cors);
}

async function compute(input: WebQuoteInput, siteId: string, deps: FacadeDeps): Promise<{ status: number; body: unknown }> {
  const size = `${input.width}/${input.ratio}R${input.rim}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((res) => {
    timer = setTimeout(() => res("timeout"), deps.timeoutMs ?? 25_000);
  });
  try {
    const work = (async () => {
      const engine = await deps.loadEngine();
      const result = await deps.runTopPrice(
        { size, load: String(input.loadIndex), speed: input.speedIndex, requestedBrand: null, quantity: input.quantity, engine },
        deps.sources(input, siteId),
      );
      return { engine, result };
    })();
    const out = await Promise.race([work, timeout]);
    if (out === "timeout") return { status: 504, body: err("upstream_timeout", "Les sources tarifaires ont mis trop de temps à répondre.") };
    const { engine, result } = out;
    const failed = result.sources.filter((s) => !s.ok).length;
    // Panne totale (aucune source, aucun catalogue) distincte de « zéro offre ».
    if (failed === result.sources.length && engine.catalog.length === 0)
      return { status: 502, body: err("sources_unavailable", "Aucune source tarifaire n'a répondu.") };
    const body = buildWebQuoteResponse({ grid: result.grid, input, partial: failed > 0, quoteId: deps.uuid(), now: deps.now() });
    if (!body.partial) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
      cache.set(webQuoteKey(input), { at: deps.now().getTime(), body });
    }
    return { status: 200, body };
  } catch {
    return { status: 500, body: err("internal_error", "Devis momentanément impossible.") };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------ Dépendances réelles ------------------------------ */

export async function realFacadeDeps(): Promise<FacadeDeps> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { runTopPrice } = await import("./tire-top-price-core");
  const db = supabaseAdmin as unknown as {
    from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
    rpc: (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  };
  return {
    loadConfig: async () => {
      const { data, error } = await db
        .from("tire_web_quote_settings")
        .select("web_supplier, site_id, enabled, allowed_origin, quota_ip_per_10min, quota_global_per_hour")
        .maybeSingle();
      if (error) throw new Error("config");
      return (data ?? null) as WebQuoteConfig | null;
    },
    districashConfigured: async (siteId) => {
      const { districashProvider } = await import("./districash");
      const { data, error } = await db
        .from("integration_credentials")
        .select("username_enc, password_enc")
        .eq("provider", districashProvider(siteId))
        .maybeSingle();
      if (error) throw new Error("districash");
      return !!(data?.username_enc && data?.password_enc);
    },
    quotaHit: async (bucket, windowSeconds, limit) => {
      const { data, error } = await db.rpc("tire_web_quota_hit", { p_bucket: bucket, p_window_seconds: windowSeconds, p_limit: limit });
      if (error) throw new Error("quota");
      return data === true;
    },
    loadEngine: async () => {
      const [s, c, p, b] = await Promise.all([
        db.from("commercial_settings").select("*").limit(1).maybeSingle(),
        db.from("tire_offers").select("*").eq("active", true),
        db.from("service_packages").select("*").eq("active", true),
        db.from("tire_brand_tiers").select("*").order("tier").order("sort_order"),
      ]);
      if (s.error || c.error || p.error || b.error) throw new Error("engine");
      return { settings: s.data ?? null, catalog: c.data ?? [], packages: p.data ?? [], brands: b.data ?? [] };
    },
    sources: (input, siteId) => ({
      centraleAllBrands: async ({ season, configured }) => {
        const { fetchPublicTiresAllBrands } = await import("./tire-provider.server");
        const r = await fetchPublicTiresAllBrands({
          size: `${input.width}/${input.ratio}R${input.rim}`, season, load: String(input.loadIndex), speed: input.speedIndex, configured,
        });
        return r.ok
          ? { ok: true, items: r.items, error: "", truncated: r.truncated === true, pagesRead: r.pagesRead ?? 0 }
          : { ok: false, items: [], error: r.error, truncated: false, pagesRead: 0 };
      },
      // Lecture seule : contrairement à la fonction interne, n'écrit pas l'état fournisseur.
      centraleLegacy: async (brands) => {
        const { fetchPublicTires } = await import("./tire-provider.server");
        const r = await fetchPublicTires(`${input.width}/${input.ratio}R${input.rim}`, brands);
        return r.ok ? { ok: true, items: r.items, error: "" } : { ok: false, items: [], error: r.error };
      },
      districash: async () => {
        const { districashSearchForSite } = await import("./districash-search.server");
        const r = await districashSearchForSite(
          siteId,
          { width: String(input.width), height: String(input.ratio), diameter: String(input.rim), load: null, speed: null },
          input.quantity,
        );
        return { ok: r.ok, rows: r.rows, error: r.error, consultedAt: r.consultedAt };
      },
    }),
    runTopPrice,
    now: () => new Date(),
    uuid: () => crypto.randomUUID(),
  };
}
