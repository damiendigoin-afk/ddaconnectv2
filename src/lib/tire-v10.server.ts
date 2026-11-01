/**
 * DDA Pneus V10 — gestionnaires HTTP (logique injectable, testée sans réseau).
 *
 * Tout reste INACTIF tant que TYRES_V10_ENABLED !== "true" (variable serveur)
 * ET que le devis web n'est pas activé : réponse 503, aucune écriture, aucun e-mail.
 * Aucun calcul de prix ici : l'offre est relue/revalidée via le moteur existant.
 */
import {
  COMMERCIAL_MAX_BODY_BYTES,
  EVENTS_MAX_BODY_BYTES,
  REPORT_RECIPIENT,
  SEASON_LABEL,
  SITE_SENDERS,
  TIER_LABEL,
  V10_VERSION,
  aggregateTraffic,
  canonicalPayload,
  commercialPreviewInput,
  commercialReference,
  commercialRequestInput,
  compareOffers,
  dailyReportWindow,
  deliveryOverall,
  eurCents,
  eventsBatch,
  enrichFromQuote,
  FRONT_OFFICE_RECIPIENTS,
  REQUEST_STALE_MS,
  fetchAllPages,
  loadBelowRequested,
  formatParisDate,
  normalizeEvents,
  parisParts,
  senderFor,
  totalLabel,
  validUntil,
  type ChannelStatus,
  type EventRow,
  type RequestLite,
} from "./tire-v10";
import { buildCommercialPdf } from "./tire-commercial-pdf";
import { corsHeaders, originAllowed, type WebQuoteCase, type WebQuoteConfig, type WebQuoteInput, type WebQuoteResponse } from "./tire-web-api";
import { clientIp, err, json, readBounded, sha } from "./tire-web-facade.server";
import { WEB_SITES, type WebSiteKey } from "./tire-web-sites";
import type { GoogleIdentity } from "./google-id-token";

export type StoredQuoteV10 = { expires_at: string; request: WebQuoteResponse["request"]; cases: WebQuoteCase[] };
export type SiteRow = { id: string; contact_email: string | null };
export type MailAttachment = { filename: string; content: string };
export type Mail = { from: string; to: string; subject: string; html: string; replyTo?: string; idempotencyKey: string; attachments: MailAttachment[] };

export type GateDeps = {
  v10Enabled: () => boolean;
  loadConfig: () => Promise<WebQuoteConfig | null>;
  quotaHit: (bucket: string, windowSeconds: number, limit: number) => Promise<boolean>;
  now: () => Date;
};

export type PrevRequest = {
  payload_hash: string; response_status: number | null; response_body: unknown;
  delivery_status?: string | null; created_at?: string | null; reference?: string | null;
};
export type CommercialDeps = GateDeps & {
  findRequest: (requestId: string) => Promise<PrevRequest | null>;
  loadQuote: (id: string) => Promise<StoredQuoteV10 | null>;
  /** Recalcul frais du devis (même moteur, sans cache). */
  revalidate: (input: WebQuoteInput, siteId: string) => Promise<{ status: number; body: unknown }>;
  loadSite: (code: string) => Promise<SiteRow | null>;
  /** Insertion atomique (UNIQUE request_id) : false si une autre requête a gagné. */
  claimRequest: (row: Record<string, unknown>) => Promise<boolean>;
  storePdf: (path: string, bytes: Uint8Array) => Promise<void>;
  updateRequest: (requestId: string, patch: Record<string, unknown>) => Promise<void>;
  recordServerEvent: (row: EventRow) => Promise<void>;
  sendEmail: (m: Mail) => Promise<{ ok: boolean; error?: string | undefined }>;
  verifiedDomains: () => string[];
  googleClientId: () => string | null;
  verifyGoogle: (token: string, clientId: string) => Promise<GoogleIdentity | null>;
  loadLogo: () => Promise<{ renault: Uint8Array | null }>;
  ipHash: (req: Request) => Promise<string>;
};

export const COMMERCIAL_QUOTA_IP_PER_HOUR = 5;
export const PREVIEW_QUOTA_IP_PER_HOUR = 20;
export const EVENTS_QUOTA_IP_PER_10MIN = 120;

const unavailable = () => err("service_unavailable", "Service momentanément indisponible.");

/** Interrupteurs + origine. Retourne une réponse d'arrêt ou le contexte. */
async function gate(req: Request, deps: GateDeps, opts: { requireQuotes: boolean }) {
  const origin = req.headers.get("origin");
  let cfg: WebQuoteConfig | null = null;
  try {
    cfg = await deps.loadConfig();
  } catch {
    return { stop: json(503, unavailable()) };
  }
  const cors = corsHeaders(origin, cfg?.allowed_origins ?? null);
  if (!deps.v10Enabled() || !cfg || (opts.requireQuotes && !cfg.enabled)) return { stop: json(503, unavailable(), cors) };
  if (!originAllowed(origin, cfg.allowed_origins)) return { stop: json(403, err("origin_not_allowed", "Origine non autorisée."), cors) };
  return { cfg, cors, origin };
}

async function readJson(req: Request, max: number, cors: Record<string, string>): Promise<{ stop: Response } | { raw: unknown }> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json"))
    return { stop: json(415, err("unsupported_media_type", "Content-Type application/json requis."), cors) };
  const text = await readBounded(req, max);
  if (text == null) return { stop: json(413, err("payload_too_large", "Requête trop volumineuse."), cors) };
  try {
    return { raw: JSON.parse(text) };
  } catch {
    return { stop: json(400, err("invalid_json", "JSON invalide."), cors) };
  }
}

const fieldsOf = (e: { issues: { path: PropertyKey[] }[] }) => [...new Set(e.issues.map((i) => String(i.path[0] ?? "body")))];

/* ------------------------------ public-config ------------------------------ */

export async function handlePublicConfig(req: Request, deps: GateDeps & { googleClientId: () => string | null }): Promise<Response> {
  const origin = req.headers.get("origin");
  let cfg: WebQuoteConfig | null = null;
  try {
    cfg = await deps.loadConfig();
  } catch {
    cfg = null;
  }
  const cors = { ...corsHeaders(origin, cfg?.allowed_origins ?? null), "Cache-Control": "public, max-age=300" };
  const enabled = deps.v10Enabled() && !!cfg?.enabled;
  const clientId = deps.googleClientId();
  return json(
    200,
    {
      version: V10_VERSION,
      enabled,
      quotesEnabled: !!cfg?.enabled,
      sites: WEB_SITES.map((s) => ({ key: s.key, label: s.label })),
      commercial: { validityDays: 7, phoneRequired: true, emailRequired: true, consentRequired: true },
      analytics: { consentRequiredForIdentifiers: true, maxBatch: 25 },
      google: clientId ? { enabled: true, clientId, scopes: ["openid", "email", "profile"] } : { enabled: false, clientId: null },
    },
    cors,
  );
}

/* ---------------------------------- events ---------------------------------- */

export async function handleEvents(
  req: Request,
  deps: GateDeps & {
    insertEvents: (rows: EventRow[]) => Promise<number>;
    ipHash: (r: Request) => Promise<string>;
    /** Lecture du devis conservé (jamais le moteur de prix) ; facultative, échec = pas d'enrichissement. */
    loadQuote?: (id: string) => Promise<StoredQuoteV10 | null>;
  },
): Promise<Response> {
  const g = await gate(req, deps, { requireQuotes: false });
  if ("stop" in g) return g.stop as Response;
  const body = await readJson(req, EVENTS_MAX_BODY_BYTES, g.cors);
  if ("stop" in body) return body.stop;
  const parsed = eventsBatch.safeParse(body.raw);
  if (!parsed.success) return json(400, { ...err("invalid_request", "Événements invalides."), fields: fieldsOf(parsed.error) }, g.cors);
  try {
    if (!(await deps.quotaHit(`v10-ev:${await deps.ipHash(req)}`, 600, EVENTS_QUOTA_IP_PER_10MIN)))
      return json(429, err("rate_limited", "Trop d'événements."), g.cors, { "Retry-After": "600" });
  } catch {
    return json(503, unavailable(), g.cors);
  }
  const rows = await enrichRows(normalizeEvents(parsed.data, deps.now()), deps.loadQuote);
  try {
    const inserted = await deps.insertEvents(rows);
    return json(202, { accepted: rows.length, inserted, duplicates: rows.length - inserted }, g.cors);
  } catch {
    return json(503, unavailable(), g.cors);
  }
}

/** Enrichissement borné (≤ 5 devis distincts, 1,5 s) : n'empêche jamais l'enregistrement des événements. */
async function enrichRows(rows: EventRow[], loadQuote?: (id: string) => Promise<StoredQuoteV10 | null>): Promise<EventRow[]> {
  if (!loadQuote) return rows;
  const ids = [...new Set(rows.map((r) => r.quote_id).filter(Boolean) as string[])].slice(0, 5);
  const quotes = new Map<string, StoredQuoteV10 | null>();
  const timeout = new Promise<void>((res) => setTimeout(res, 1500));
  await Promise.race([
    Promise.all(ids.map(async (id) => quotes.set(id, await loadQuote(id).catch(() => null)))),
    timeout,
  ]);
  return rows.map((r) => enrichFromQuote(r, r.quote_id ? quotes.get(r.quote_id) ?? null : null));
}

/* ---------------------------- commercial-preview ---------------------------- */

export async function handleCommercialPreview(req: Request, deps: CommercialDeps): Promise<Response> {
  const g = await gate(req, deps, { requireQuotes: true });
  if ("stop" in g) return g.stop as Response;
  const body = await readJson(req, COMMERCIAL_MAX_BODY_BYTES, g.cors);
  if ("stop" in body) return body.stop;
  const parsed = commercialPreviewInput.safeParse(body.raw);
  if (!parsed.success) return json(400, { ...err("invalid_request", "Champs invalides."), fields: fieldsOf(parsed.error) }, g.cors);
  const i = parsed.data;
  try {
    if (!(await deps.quotaHit(`v10-pv:${await deps.ipHash(req)}`, 3600, PREVIEW_QUOTA_IP_PER_HOUR)))
      return json(429, err("rate_limited", "Trop de demandes."), g.cors, { "Retry-After": "3600" });
  } catch {
    return json(503, unavailable(), g.cors);
  }
  let quote: StoredQuoteV10 | null;
  try {
    quote = await deps.loadQuote(i.quoteId);
  } catch {
    return json(503, unavailable(), g.cors);
  }
  const now = deps.now();
  if (!quote || new Date(quote.expires_at).getTime() < now.getTime())
    return json(409, err("quote_expired", "Devis expiré : relancez une recherche."), g.cors);
  const offer = quote.cases.find((c) => c.tier === i.tier && c.season === i.season);
  if (!offer || offer.status !== "available") return json(422, err("offer_unavailable", "Proposition indisponible."), g.cors);
  if (loadBelowRequested(offer.loadIndex, quote.request.loadIndex)) return json(422, loadErr(), g.cors);
  const pdf = await buildCommercialPdf(
    {
      reference: "APERCU", issuedAt: now, validUntil: validUntil(now), preview: true,
      customer: { name: i.name, email: i.email, phone: i.phone }, garageLabel: SITE_SENDERS[i.site].label, offer,
    },
    await deps.loadLogo().catch(() => ({ renault: null })),
  );
  return new Response(pdf as BodyInit, {
    status: 200,
    headers: { ...g.cors, "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="apercu-devis-pneus.pdf"', "Cache-Control": "no-store" },
  });
}

/* ---------------------------- commercial-requests ---------------------------- */

const loadErr = () => err("offer_load_insufficient", "Indice de charge de l'offre inférieur à celui demandé : proposition refusée.");

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildCommercialEmails(a: { reference: string; site: WebSiteKey; offer: WebQuoteCase; validUntil: Date; name: string; email: string; phone: string; message?: string | undefined }) {
  const o = a.offer;
  const offerLine = `${esc(o.brand ?? "")} ${esc(o.model ?? "")} — ${esc(o.size ?? "")} ${esc(o.loadIndex ?? "")}${esc(o.speedIndex ?? "")} · ${SEASON_LABEL[o.season]} · ${TIER_LABEL[o.tier]} · x${o.quantity}`;
  const total = `${totalLabel(o)} : <strong>${eurCents(o.totalTtcCents ?? 0)}</strong>`;
  const validity = `Valable jusqu'au ${formatParisDate(a.validUntil)}, sous réserve de disponibilité. Compatibilité avec votre véhicule à confirmer par le garage.`;
  const garage = SITE_SENDERS[a.site].label;
  return {
    client: {
      subject: `Votre devis pneus ${a.reference} — ${garage}`,
      html: `<p>Bonjour ${esc(a.name)},</p><p>Voici votre devis (PDF joint).</p><p>${offerLine}<br>${total}</p><p>${validity}</p><p>${esc(garage)} vous recontacte rapidement.</p><p><em>Beaucoup de garages réparent votre voiture. Nous, nous en prenons soin.</em></p>`,
    },
    frontOffice: {
      subject: `Nouvelle demande devis pneus ${a.reference}`,
      html: `<p>Nouvelle demande depuis le site DDA Pneus pour <strong>${esc(garage)}</strong>.</p><p>Client : ${esc(a.name)}<br>Tél : ${esc(a.phone)}<br>E-mail : ${esc(a.email)}</p><p>${offerLine}<br>${total}</p>${a.message ? `<p>Message : ${esc(a.message)}</p>` : ""}<p>${validity}</p><p>Statut prospect : nouveau.</p>`,
    },
  };
}

export async function handleCommercialRequest(req: Request, deps: CommercialDeps): Promise<Response> {
  const g = await gate(req, deps, { requireQuotes: true });
  if ("stop" in g) return g.stop as Response;
  const { cfg, cors } = g as { cfg: WebQuoteConfig; cors: Record<string, string>; origin: string | null };
  const body = await readJson(req, COMMERCIAL_MAX_BODY_BYTES, cors);
  if ("stop" in body) return body.stop;
  const parsed = commercialRequestInput.safeParse(body.raw);
  if (!parsed.success) return json(400, { ...err("invalid_request", "Champs invalides."), fields: fieldsOf(parsed.error) }, cors);
  const i = parsed.data;
  const hash = await sha(canonicalPayload(i));

  // 1. Idempotence : même requestId => réponse rejouée, jamais de second envoi.
  try {
    const prev = await deps.findRequest(i.requestId);
    if (prev) return replay(prev, hash, cors, deps.now());
  } catch {
    return json(503, unavailable(), cors);
  }

  let ipHash: string;
  try {
    ipHash = await deps.ipHash(req);
    if (!(await deps.quotaHit(`v10-cr:${ipHash}`, 3600, COMMERCIAL_QUOTA_IP_PER_HOUR)))
      return json(429, err("rate_limited", "Trop de demandes."), cors, { "Retry-After": "3600" });
  } catch {
    return json(503, unavailable(), cors);
  }

  // 2. Offre acceptée par le client (devis conservé).
  let quote: StoredQuoteV10 | null;
  let site: SiteRow | null;
  try {
    quote = await deps.loadQuote(i.quoteId);
    site = await deps.loadSite(WEB_SITES.find((w) => w.key === i.site)!.code);
  } catch {
    return json(503, unavailable(), cors);
  }
  if (!quote) return json(409, err("quote_expired", "Devis introuvable : relancez une recherche."), cors);
  if (!site) return json(422, { ...err("invalid_site", "Garage indisponible."), fields: ["site"] }, cors);
  const accepted = quote.cases.find((c) => c.tier === i.tier && c.season === i.season);
  if (!accepted || accepted.status !== "available") return json(422, err("offer_unavailable", "Proposition indisponible."), cors);
  if (loadBelowRequested(accepted.loadIndex, quote.request.loadIndex)) return json(422, loadErr(), cors);

  // 3. Google (facultatif) : vérifié serveur ; aucun droit accordé.
  let googleVerified = false;
  if (i.googleIdToken) {
    const cid = deps.googleClientId();
    if (!cid) return json(400, { ...err("google_disabled", "Connexion Google indisponible."), fields: ["googleIdToken"] }, cors);
    const id = await deps.verifyGoogle(i.googleIdToken, cid).catch(() => null);
    if (!id) return json(401, err("google_invalid", "Identité Google non vérifiée."), cors);
    googleVerified = id.email === i.email.toLowerCase();
  }

  // 4. Revalidation serveur fraîche (pas le cache 5 min).
  const q = quote.request;
  const m = /^(\d+)\/(\d+)R(\d+)$/.exec(q.size);
  if (!m || !cfg.site_id) return json(503, unavailable(), cors);
  const fresh = await deps
    .revalidate({ width: +m[1]!, ratio: +m[2]!, rim: +m[3]!, loadIndex: q.loadIndex, speedIndex: q.speedIndex, quantity: q.quantity as 1 | 2 | 4 }, cfg.site_id)
    .catch(() => ({ status: 500, body: null }));
  if (fresh.status !== 200 || !fresh.body)
    return json(503, err("revalidation_unavailable", "Vérification du prix impossible pour le moment. Réessayez."), cors);
  const freshBody = fresh.body as WebQuoteResponse;
  const freshCase = freshBody.cases.find((c) => c.tier === i.tier && c.season === i.season);
  // Contrôle de charge sur l'offre FRAÎCHE, avant tout enregistrement.
  if (freshCase && freshCase.status === "available" && loadBelowRequested(freshCase.loadIndex, q.loadIndex)) return json(422, loadErr(), cors);
  const cmp = compareOffers(accepted, freshCase);
  if (!cmp.same)
    return json(
      409,
      {
        ...err("offer_changed", "Le prix ou le modèle a changé : merci de valider la nouvelle proposition."),
        changed: cmp.changed,
        quoteId: freshBody.quoteId,
        expiresAt: freshBody.expiresAt,
        offer: freshCase && freshCase.status === "available" ? freshCase : null,
      },
      cors,
    );

  // 5. Enregistrement atomique AVANT tout envoi.
  const now = deps.now();
  const reference = commercialReference(now, i.requestId);
  const until = validUntil(now);
  const pdfPath = `${i.site}/${parisParts(now).day.slice(0, 7)}/${i.requestId}.pdf`;
  let claimed: boolean;
  try {
    claimed = await deps.claimRequest({
      request_id: i.requestId, reference, payload_hash: hash, quote_id: i.quoteId, tier: i.tier, season: i.season,
      site_key: i.site, site_id: site.id, customer_name: i.name, email: i.email, phone: i.phone, message: i.message ?? null,
      consent_at: now.toISOString(), google_verified: googleVerified, offer_snapshot: accepted,
      total_ttc_cents: accepted.totalTtcCents, valid_until: until.toISOString(), prospect_status: "nouveau",
      delivery_status: "pending", ip_hash: ipHash, origin: req.headers.get("origin"),
    });
  } catch {
    return json(500, err("internal_error", "Enregistrement impossible."), cors);
  }
  if (!claimed) {
    const prev = await deps.findRequest(i.requestId).catch(() => null);
    return prev ? replay(prev, hash, cors, deps.now()) : json(409, err("request_in_progress", "Demande déjà en cours."), cors);
  }

  // 6. PDF archivé privé. Échec => enregistré, aucun e-mail.
  let pdf: Uint8Array | null = null;
  try {
    pdf = await buildCommercialPdf(
      { reference, issuedAt: now, validUntil: until, customer: { name: i.name, email: i.email, phone: i.phone }, garageLabel: SITE_SENDERS[i.site].label, offer: accepted },
      await deps.loadLogo().catch(() => ({ renault: null })),
    );
    await deps.storePdf(pdfPath, pdf);
  } catch {
    pdf = null;
  }

  let client: ChannelStatus = "not_sent";
  let fo: ChannelStatus = "not_sent";
  let deliveryError: string | null = null;
  const sender = senderFor(i.site, deps.verifiedDomains());
  // Destinataire FO validé uniquement ; sites.contact_email divergent => signalé, jamais utilisé.
  const foTo = FRONT_OFFICE_RECIPIENTS[i.site];
  const siteMail = (site.contact_email ?? "").trim().toLowerCase();
  const foMismatch = siteMail !== "" && siteMail !== foTo;
  if (foMismatch) console.warn("[tyres-v10] fo_recipient_mismatch", i.site);
  if (!pdf) deliveryError = "pdf_failed";
  else if (!sender.ok) deliveryError = "sender_not_verified";
  else {
    // Marque « envoi en cours » AVANT tout e-mail : si cette écriture échoue, aucun envoi (pas d'état inconnu).
    try {
      await deps.updateRequest(i.requestId, { pdf_path: pdfPath, delivery_status: "sending", emails_attempted_at: now.toISOString(), fo_recipient: foTo });
    } catch {
      deliveryError = "status_not_saved";
    }
  }
  if (!deliveryError && pdf && sender.ok) {
    const mails = buildCommercialEmails({ reference, site: i.site, offer: accepted, validUntil: until, name: i.name, email: i.email, phone: i.phone, message: i.message });
    const att = [{ filename: `devis-pneus-${reference}.pdf`, content: b64(pdf) }];
    const send = async (m: Mail): Promise<ChannelStatus> => {
      try {
        return (await deps.sendEmail(m)).ok ? "sent" : "failed";
      } catch {
        return "failed";
      }
    };
    client = await send({ from: sender.from, to: i.email, ...mails.client, replyTo: SITE_SENDERS[i.site].address, idempotencyKey: `tyres-v10-client-${i.requestId}`, attachments: att });
    fo = await send({ from: sender.from, to: foTo, ...mails.frontOffice, replyTo: i.email, idempotencyKey: `tyres-v10-fo-${i.requestId}`, attachments: att });
  }
  const overall = deliveryOverall(client, fo);
  const responseBody = {
    requestId: i.requestId,
    reference,
    status: "recorded",
    prospectStatus: "nouveau",
    validUntil: until.toISOString(),
    totalTtcCents: accepted.totalTtcCents,
    delivery: { overall, client, frontOffice: fo, reason: deliveryError, frontOfficeRecipientMismatch: foMismatch },
    message:
      overall === "delivered"
        ? "Demande enregistrée. Votre devis a été transmis au service d'envoi d'e-mails."
        : "Demande enregistrée. L'envoi du devis par e-mail n'a pas pu être confirmé : le garage vous recontactera.",
  };
  const finalPatch = {
    pdf_path: pdf ? pdfPath : null, delivery_status: overall, client_email_status: client, fo_email_status: fo,
    delivery_error: deliveryError, fo_recipient: foTo, response_status: 201, response_body: responseBody,
  };
  // Écriture finale : 3 tentatives. Échec persistant => la ligne reste « sending »/« pending » ;
  // un rejeu renverra 202 « statut inconnu » SANS renvoi (reprise administrative, voir contrat).
  let saved = false;
  for (let k = 0; k < 3 && !saved; k++) {
    try {
      await deps.updateRequest(i.requestId, finalPatch);
      saved = true;
    } catch {
      /* réessai */
    }
  }
  if (!saved) console.warn("[tyres-v10] request_final_status_not_saved");
  const pp = parisParts(now);
  await deps
    .recordServerEvent({
      event_id: crypto.randomUUID(), type: "request_submitted", occurred_at: now.toISOString(),
      // Corrélation pseudonyme uniquement si le visiteur a consenti (contexte analytics facultatif).
      consent: !!i.analytics, visitor_id: i.analytics?.visitorId ?? null, session_id: i.analytics?.sessionId ?? null,
      quote_id: i.quoteId, offer_brand: accepted.brand ?? null, offer_verified: true,
      page: null, device: null, utm_source: null, utm_medium: null, utm_campaign: null, size: q.size, quantity: q.quantity,
      tier: i.tier, season: i.season, site_key: i.site, paris_day: pp.day, paris_hour: pp.hour, paris_weekday: pp.weekday,
    })
    .catch(() => undefined);
  return json(201, responseBody, cors);
}

function replay(prev: PrevRequest, hash: string, cors: Record<string, string>, now: Date = new Date()) {
  if (prev.payload_hash !== hash) return json(409, err("idempotency_conflict", "Identifiant de demande déjà utilisé pour un autre contenu."), cors);
  if (!prev.response_body) {
    const age = prev.created_at ? now.getTime() - new Date(prev.created_at).getTime() : 0;
    if (prev.delivery_status === "sending" || age > REQUEST_STALE_MS)
      // Enregistrée, issue d'envoi inconnue : jamais de renvoi automatique.
      return json(202, {
        status: "recorded", reference: prev.reference ?? null,
        delivery: { overall: "unknown", client: "unknown", frontOffice: "unknown", reason: "status_unknown" },
        message: "Demande enregistrée. L'envoi du devis par e-mail n'est pas confirmé : le garage vous recontactera.",
      }, cors, { "Idempotent-Replay": "true" });
    return json(409, err("request_in_progress", "Demande déjà en cours."), cors);
  }
  return json(prev.response_status ?? 201, prev.response_body, cors, { "Idempotent-Replay": "true" });
}

/* ------------------------------ rapport quotidien ------------------------------ */

export type ReportDeps = {
  v10Enabled: () => boolean;
  secret: () => string | null;
  now: () => Date;
  loadPeriod: (start: Date, end: Date) => Promise<{ events: EventRow[]; requests: RequestLite[]; pending: RequestLite[]; truncated?: boolean }>;
  /** Prise atomique : nouvelle date, échec confirmé ou « running » abandonné. null => déjà envoyé / en cours. */
  claimReport: (reportDate: string) => Promise<{ sendKey: string } | null>;
  finishReport: (reportDate: string, patch: { status: "sent" | "failed"; error: string | null }) => Promise<void>;
  sendEmail: (m: Omit<Mail, "attachments" | "replyTo">) => Promise<{ ok: boolean; error?: string | undefined }>;
  verifiedDomains: () => string[];
};

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let k = 0; k < a.length; k++) r |= a.charCodeAt(k) ^ b.charCodeAt(k);
  return r === 0;
}

export function buildDailyReportHtml(date: string, agg: ReturnType<typeof aggregateTraffic>, pending: RequestLite[], truncated = false): string {
  const row = (k: string, v: string | number) => `<tr><td>${esc(k)}</td><td><strong>${esc(String(v))}</strong></td></tr>`;
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  return `<h2>DDA Pneus — rapport du ${esc(date)}</h2><table>
${row("Pages vues", agg.totals.pageViews)}${row("Sessions démarrées", agg.totals.sessionStarts)}${row("Devis générés", agg.totals.quotes)}${row("Offres choisies", agg.totals.offerSelected)}
${row("Nouvelles demandes", agg.totals.requests)}${row("Demandes Castillon", agg.requestsBySite['castillon'] ?? 0)}${row("Demandes Lalinde", agg.requestsBySite['lalinde'] ?? 0)}
${row("Prospects à traiter (nouveau / à contacter)", pending.length)}${row("Couverture du consentement", pct(agg.consentCoverage.ratio))}</table>
<p>Couverture = part des événements reçus avec consentement ; ce n'est pas une proportion des visiteurs totaux (les visiteurs sans consentement ou bloquant la mesure ne sont pas tous comptés). Visiteurs distincts comptés uniquement parmi les consentants.</p>${truncated ? "<p><strong>Attention : volume supérieur au plafond de lecture, chiffres incomplets.</strong></p>" : ""}`;
}

export async function handleDailyReport(req: Request, deps: ReportDeps): Promise<Response> {
  if (!deps.v10Enabled()) return json(503, unavailable());
  const secret = deps.secret();
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || secret.length < 32) return json(503, unavailable());
  if (!token || !safeEqual(token, secret)) return json(401, err("unauthorized", "Non autorisé."));
  const w = dailyReportWindow(deps.now());
  const force = new URL(req.url).searchParams.get("force") === "1";
  if (!w.shouldRun && !force) return json(200, { skipped: "not_7am_paris", reportDate: w.reportDate });
  const from = senderFor("castillon", deps.verifiedDomains());
  if (!from.ok) return json(503, err("sender_not_verified", "Expéditeur non vérifié."));
  let claim: { sendKey: string } | null;
  try {
    claim = await deps.claimReport(w.reportDate);
  } catch {
    return json(503, unavailable());
  }
  if (!claim) return json(200, { skipped: "already_done", reportDate: w.reportDate });
  try {
    const d = await deps.loadPeriod(w.start, w.end);
    const agg = aggregateTraffic(d.events, d.requests);
    const r = await deps.sendEmail({
      from: from.from, to: REPORT_RECIPIENT, subject: `DDA Pneus — rapport du ${w.reportDate}`,
      html: buildDailyReportHtml(w.reportDate, agg, d.pending, !!d.truncated), idempotencyKey: claim.sendKey,
    });
    await deps.finishReport(w.reportDate, r.ok ? { status: "sent", error: null } : { status: "failed", error: (r.error ?? "refus").slice(0, 300) });
    return json(r.ok ? 200 : 502, { reportDate: w.reportDate, sent: r.ok });
  } catch {
    await deps.finishReport(w.reportDate, { status: "failed", error: "exception" }).catch(() => undefined);
    return json(500, err("internal_error", "Rapport impossible."));
  }
}

/* ------------------------------ dépendances réelles ------------------------------ */

export const V10_BUCKET = "tyre-commercial-quotes";

export async function realV10Deps(req: Request): Promise<CommercialDeps & ReportDeps & { insertEvents: (rows: EventRow[]) => Promise<number> }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { realFacadeDeps, freshWebQuote } = await import("./tire-web-facade.server");
  const { parseVerifiedDomains } = await import("./tire-v10");
  const facade = await realFacadeDeps();
  const db = supabaseAdmin as unknown as {
    from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
    storage: { from: (b: string) => { upload: (p: string, b: Uint8Array, o: Record<string, unknown>) => Promise<{ error: unknown }> } };
  };
  const env = (k: string) => process.env[k] ?? null;
  return {
    v10Enabled: () => env("TYRES_V10_ENABLED") === "true",
    loadConfig: facade.loadConfig,
    quotaHit: facade.quotaHit,
    now: () => new Date(),
    ipHash: async (r) => sha(`${new Date().toISOString().slice(0, 10)}|${clientIp(r)}`),
    findRequest: async (id) => {
      const { data, error } = await db.from("tyre_commercial_requests").select("payload_hash, response_status, response_body, delivery_status, created_at, reference").eq("request_id", id).maybeSingle();
      if (error) throw new Error("find");
      return data ?? null;
    },
    loadQuote: async (id) => {
      const { data, error } = await db.from("tire_web_quotes").select("expires_at, request, cases").eq("id", id).maybeSingle();
      if (error) throw new Error("quote");
      return data ?? null;
    },
    revalidate: (input, siteId) => freshWebQuote(input, siteId, facade),
    loadSite: async (code) => {
      const { data, error } = await db.from("sites").select("id, contact_email").eq("code", code).eq("active", true).maybeSingle();
      if (error) throw new Error("site");
      return data ?? null;
    },
    claimRequest: async (row) => {
      const { data, error } = await db.from("tyre_commercial_requests").upsert(row, { onConflict: "request_id", ignoreDuplicates: true }).select("id");
      if (error) throw new Error("claim");
      return Array.isArray(data) && data.length === 1;
    },
    storePdf: async (path, bytes) => {
      const { error } = await db.storage.from(V10_BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: false });
      if (error) throw new Error("store");
    },
    updateRequest: async (id, patch) => {
      const { error } = await db.from("tyre_commercial_requests").update(patch).eq("request_id", id);
      if (error) throw new Error("update");
    },
    recordServerEvent: async (row) => {
      await db.from("tyre_web_events").upsert(row, { onConflict: "event_id", ignoreDuplicates: true });
    },
    insertEvents: async (rows) => {
      const { data, error } = await db.from("tyre_web_events").upsert(rows, { onConflict: "event_id", ignoreDuplicates: true }).select("event_id");
      if (error) throw new Error("events");
      return Array.isArray(data) ? data.length : 0;
    },
    sendEmail: async (m) => {
      const { sendEmailWithAttachments } = await import("./email.server");
      const r = await sendEmailWithAttachments({ ...m, attachments: "attachments" in m ? (m as Mail).attachments : [] });
      return { ok: r.ok, error: r.error };
    },
    verifiedDomains: () => parseVerifiedDomains(env("TYRES_V10_VERIFIED_SENDER_DOMAINS")),
    googleClientId: () => {
      const v = env("GOOGLE_IDENTITY_CLIENT_ID");
      return v && /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(v) ? v : null;
    },
    verifyGoogle: async (token, clientId) => {
      const { verifyGoogleIdToken, fetchGoogleKeys } = await import("./google-id-token");
      const r = await verifyGoogleIdToken(token, { clientId, now: new Date(), getKeys: fetchGoogleKeys });
      return r.ok ? r.identity : null;
    },
    loadLogo: async () => {
      const asset = (await import("@/assets/dda-renault-logo.jpeg.asset.json")).default as { url: string };
      const r = await fetch(new URL(asset.url, new URL(req.url).origin));
      return { renault: r.ok ? new Uint8Array(await r.arrayBuffer()) : null };
    },
    secret: () => env("TYRES_REPORT_SECRET"),
    loadPeriod: async (start, end) => {
      const cols = "created_at, site_key, prospect_status, delivery_status";
      const [e, r, p] = await Promise.all([
        fetchAllPages<EventRow>((a, b) => db.from("tyre_web_events").select("*").gte("occurred_at", start.toISOString()).lt("occurred_at", end.toISOString()).order("occurred_at").order("event_id").range(a, b)),
        fetchAllPages<RequestLite>((a, b) => db.from("tyre_commercial_requests").select(cols).gte("created_at", start.toISOString()).lt("created_at", end.toISOString()).order("created_at").order("request_id").range(a, b)),
        fetchAllPages<RequestLite>((a, b) => db.from("tyre_commercial_requests").select(cols).in("prospect_status", ["nouveau", "a_contacter"]).order("created_at").order("request_id").range(a, b)),
      ]);
      return { events: e.rows, requests: r.rows, pending: p.rows, truncated: e.truncated || r.truncated || p.truncated };
    },
    claimReport: async (date) => {
      const { reportSendKey, REPORT_STALE_MS } = await import("./tire-v10");
      const startedAt = new Date().toISOString();
      const firstKey = reportSendKey(date, "none", 1, null);
      const ins = await db.from("tyre_daily_reports")
        .upsert({ report_date: date, status: "running", attempts: 1, send_key: firstKey, started_at: startedAt }, { onConflict: "report_date", ignoreDuplicates: true })
        .select("report_date");
      if (ins.error) throw new Error("claim");
      if (Array.isArray(ins.data) && ins.data.length === 1) return { sendKey: firstKey };
      const cur = await db.from("tyre_daily_reports").select("status, attempts, send_key, started_at").eq("report_date", date).maybeSingle();
      if (cur.error || !cur.data) throw new Error("claim");
      const row = cur.data as { status: string; attempts: number; send_key: string | null; started_at: string | null };
      const stale = row.status === "running" && (!row.started_at || Date.now() - new Date(row.started_at).getTime() > REPORT_STALE_MS);
      if (row.status !== "failed" && !stale) return null; // envoyé ou en cours
      const attempt = row.attempts + 1;
      const sendKey = reportSendKey(date, row.status === "failed" ? "failed" : "stale", attempt, row.send_key);
      // Mise à jour optimiste (même status/attempts) : une seule reprise gagne.
      const upd = await db.from("tyre_daily_reports")
        .update({ status: "running", attempts: attempt, send_key: sendKey, started_at: startedAt, error: null, finished_at: null })
        .eq("report_date", date).eq("status", row.status).eq("attempts", row.attempts).select("report_date");
      if (upd.error) throw new Error("claim");
      return Array.isArray(upd.data) && upd.data.length === 1 ? { sendKey } : null;
    },
    finishReport: async (date, patch) => {
      await db.from("tyre_daily_reports").update({ ...patch, finished_at: new Date().toISOString() }).eq("report_date", date);
    },
  };
}

export async function handleV10Options(req: Request, deps: Pick<GateDeps, "loadConfig">, methods = "POST, OPTIONS"): Promise<Response> {
  const origin = req.headers.get("origin");
  const allowed = await deps.loadConfig().then((c) => c?.allowed_origins ?? null).catch(() => null);
  const h = corsHeaders(origin, allowed);
  if (h["Access-Control-Allow-Methods"]) h["Access-Control-Allow-Methods"] = methods;
  return new Response(null, { status: originAllowed(origin, allowed) ? 204 : 403, headers: h });
}
