/**
 * Demande de rendez-vous pneus depuis le site vitrine
 * (POST /api/public/tyres/appointment-requests).
 *
 * Une DEMANDE à confirmer par le garage : ni réservation ferme, ni paiement,
 * ni commande fournisseur. L'offre retenue est relue côté serveur depuis le
 * devis conservé (tire_web_quotes) : le prix envoyé par le navigateur n'est
 * jamais cru. Journalisation minimale, sans donnée personnelle.
 */
import {
  WEB_APPT_MAX_BODY_BYTES,
  corsHeaders,
  looksLikeBot,
  originAllowed,
  slotsInRange,
  webAppointmentInput,
  type WebQuoteCase,
  type WebQuoteConfig,
} from "./tire-web-api";
import { clientIp, err, json, readBounded, sha } from "./tire-web-facade.server";
import { WEB_SITES } from "./tire-web-sites";
import { buildFrontOfficeEmail, type FrontOfficeSite } from "./tire-web-notify";

export type StoredQuote = { expires_at: string; cases: WebQuoteCase[] };

export type AppointmentDeps = {
  loadConfig: () => Promise<WebQuoteConfig | null>;
  quotaHit: (bucket: string, windowSeconds: number, limit: number) => Promise<boolean>;
  loadQuote: (id: string) => Promise<StoredQuote | null>;
  insertRequest: (row: Record<string, unknown>) => Promise<string>;
  /** Garage actif par code interne, avec son adresse d'accueil configurée (sites.contact_email). */
  loadSite: (code: string) => Promise<FrontOfficeSite | null>;
  sendEmail: (m: { to: string; subject: string; html: string; replyTo?: string; idempotencyKey: string }) => Promise<{ ok: boolean; error?: string | undefined }>;
  updateNotification: (id: string, patch: { notification_status: string; notification_error: string | null; notified_at: string | null }) => Promise<void>;
  now: () => Date;
};

export const APPT_QUOTA_IP_PER_HOUR = 3;
export const APPT_QUOTA_GLOBAL_PER_HOUR = 60;

const ACCEPTED = {
  status: "a_confirmer",
  message: "Demande reçue. Le garage vous recontactera pour confirmer le rendez-vous.",
};
const unavailable = () => err("service_unavailable", "Demande de rendez-vous momentanément indisponible.");

export async function handleAppointmentOptions(req: Request, deps: Pick<AppointmentDeps, "loadConfig">): Promise<Response> {
  const origin = req.headers.get("origin");
  let allowed: string[] | null = null;
  try {
    allowed = (await deps.loadConfig())?.allowed_origins ?? null;
  } catch {
    allowed = null;
  }
  return new Response(null, { status: originAllowed(origin, allowed) ? 204 : 403, headers: corsHeaders(origin, allowed) });
}

export async function handleAppointmentPost(req: Request, deps: AppointmentDeps): Promise<Response> {
  const origin = req.headers.get("origin");
  let cfg: WebQuoteConfig | null;
  try {
    cfg = await deps.loadConfig();
  } catch {
    return json(503, unavailable());
  }
  const cors = corsHeaders(origin, cfg?.allowed_origins ?? null);
  // Même interrupteur que le devis : désactivé => 503 (activation gardée en base).
  if (!cfg?.enabled) return json(503, unavailable(), cors);
  if (!originAllowed(origin, cfg.allowed_origins)) return json(403, err("origin_not_allowed", "Origine non autorisée."), cors);
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json"))
    return json(415, err("unsupported_media_type", "Content-Type application/json requis."), cors);
  const text = await readBounded(req, WEB_APPT_MAX_BODY_BYTES);
  if (text == null) return json(413, err("payload_too_large", "Requête trop volumineuse."), cors);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json(400, err("invalid_json", "JSON invalide."), cors);
  }
  const parsed = webAppointmentInput.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "body")))];
    return json(400, { ...err("invalid_request", "Champs invalides."), fields }, cors);
  }
  const input = parsed.data;
  const now = deps.now();

  // Anti-robot : réponse neutre identique, rien n'est enregistré.
  if (looksLikeBot(input)) {
    console.info("[tyres-web] appt_dropped_bot");
    return json(202, { requestId: null, ...ACCEPTED }, cors);
  }
  if (!slotsInRange(input.preferredSlots, now))
    return json(400, { ...err("invalid_request", "Créneaux hors période."), fields: ["preferredSlots"] }, cors);

  let ipHash: string;
  try {
    ipHash = await sha(`${now.toISOString().slice(0, 10)}|${clientIp(req)}`);
    const ipOk = await deps.quotaHit(`appt-ip:${ipHash}`, 3600, APPT_QUOTA_IP_PER_HOUR);
    const globalOk = ipOk ? await deps.quotaHit("appt-global", 3600, APPT_QUOTA_GLOBAL_PER_HOUR) : false;
    if (!ipOk || !globalOk) return json(429, err("rate_limited", "Trop de demandes, réessayez plus tard."), cors, { "Retry-After": "3600" });
  } catch {
    return json(503, unavailable(), cors);
  }

  // Garage : uniquement l'un des deux garages publics, actif en base.
  const pick = (k: string | undefined) => WEB_SITES.find((w) => w.key === k);
  let site: FrontOfficeSite | null;
  let suggested: FrontOfficeSite | null = null;
  try {
    site = await deps.loadSite(pick(input.site)!.code);
    if (input.suggestedSite) suggested = await deps.loadSite(pick(input.suggestedSite)!.code);
  } catch {
    return json(503, unavailable(), cors);
  }
  if (!site) return json(422, { ...err("invalid_site", "Garage indisponible."), fields: ["site"] }, cors);

  let quote: StoredQuote | null;
  try {
    quote = await deps.loadQuote(input.quoteId);
  } catch {
    return json(503, unavailable(), cors);
  }
  if (!quote || new Date(quote.expires_at).getTime() < now.getTime())
    return json(409, err("quote_expired", "Devis expiré : relancez une recherche avant de demander un rendez-vous."), cors);
  const offer = quote.cases.find((c) => c.tier === input.tier && c.season === input.season);
  if (!offer || offer.status !== "available")
    return json(422, err("offer_unavailable", "Cette proposition n'est pas disponible dans le devis."), cors);

  let id: string;
  try {
    id = await deps.insertRequest({
      status: "a_confirmer",
      quote_id: input.quoteId,
      selected_tier: input.tier,
      selected_season: input.season,
      offer_snapshot: offer,
      customer_name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      plate: input.plate ? input.plate.toUpperCase().replace(/[\s-]+/g, "-") : null,
      preferred_slots: input.preferredSlots,
      message: input.message ?? null,
      consent_at: now.toISOString(),
      ip_hash: ipHash,
      origin,
      site_id: site.id,
      site_choice_method: input.siteChoiceMethod,
      suggested_site_id: suggested?.id ?? null,
      notification_status: "pending",
    });
    console.info("[tyres-web] appt_created");
  } catch {
    console.warn("[tyres-web] appt_insert_failed");
    return json(500, err("internal_error", "Demande momentanément impossible."), cors);
  }

  // Notification au front office du garage choisi. La demande est déjà conservée :
  // un échec n'annule rien, il est tracé pour l'administration (jamais de faux succès).
  const label = WEB_SITES.find((w) => w.key === input.site)!.label;
  await notifyFrontOffice(deps, id, site, label, { ...input, offer, createdAt: now });
  return json(201, { requestId: id, ...ACCEPTED, site: input.site }, cors);
}

async function notifyFrontOffice(
  deps: AppointmentDeps,
  id: string,
  site: FrontOfficeSite,
  label: string,
  data: Parameters<typeof buildFrontOfficeEmail>[0]["request"],
) {
  const to = (site.contact_email ?? "").trim();
  let patch: { notification_status: string; notification_error: string | null; notified_at: string | null };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    patch = { notification_status: "not_configured", notification_error: "Adresse d'accueil du garage non renseignée.", notified_at: null };
  } else {
    try {
      const mail = buildFrontOfficeEmail({ requestId: id, siteLabel: label, request: data });
      const r = await deps.sendEmail({ to, ...mail, ...(data.email ? { replyTo: data.email } : {}), idempotencyKey: `tyres-appt-${id}` });
      patch = r.ok
        ? { notification_status: "sent", notification_error: null, notified_at: deps.now().toISOString() }
        : { notification_status: "failed", notification_error: (r.error ?? "Envoi refusé").slice(0, 300), notified_at: null };
    } catch {
      patch = { notification_status: "failed", notification_error: "Envoi impossible.", notified_at: null };
    }
  }
  console.info(`[tyres-web] appt_notify_${patch.notification_status}`);
  try {
    await deps.updateNotification(id, patch);
  } catch {
    console.warn("[tyres-web] appt_notify_status_not_saved");
  }
}

export async function realAppointmentDeps(): Promise<AppointmentDeps> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as {
    from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
    rpc: (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  };
  return {
    loadConfig: async () => {
      const { data, error } = await db
        .from("tire_web_quote_settings")
        .select("web_supplier, site_id, enabled, allowed_origins, quota_ip_per_10min, quota_global_per_hour")
        .maybeSingle();
      if (error) throw new Error("config");
      return (data ?? null) as WebQuoteConfig | null;
    },
    quotaHit: async (bucket, windowSeconds, limit) => {
      const { data, error } = await db.rpc("tire_web_quota_hit", { p_bucket: bucket, p_window_seconds: windowSeconds, p_limit: limit });
      if (error) throw new Error("quota");
      return data === true;
    },
    loadQuote: async (id) => {
      const { data, error } = await db.from("tire_web_quotes").select("expires_at, cases").eq("id", id).maybeSingle();
      if (error) throw new Error("quote");
      return (data ?? null) as StoredQuote | null;
    },
    insertRequest: async (row) => {
      const { data, error } = await db.from("tire_web_appointment_requests").insert(row).select("id").single();
      if (error || !data) throw new Error("insert");
      return data.id as string;
    },
    loadSite: async (code) => {
      const { data, error } = await db.from("sites").select("id, contact_email").eq("code", code).eq("active", true).maybeSingle();
      if (error) throw new Error("site");
      return (data ?? null) as FrontOfficeSite | null;
    },
    sendEmail: async (m) => {
      const { sendEmail } = await import("./email.server");
      const r = await sendEmail(m);
      return { ok: r.ok, error: r.error };
    },
    updateNotification: async (id, patch) => {
      const { error } = await db.from("tire_web_appointment_requests").update(patch).eq("id", id);
      if (error) throw new Error("notify");
    },
    now: () => new Date(),
  };
}
