/**
 * DDA Pneus V10 — règles pures (testables, sans réseau ni base).
 *
 * - Devis commercial DDA Care : une sélection, total TTC exact issu du devis
 *   Top prix (aucune ventilation recalculée), validité 7 jours sous réserve
 *   de disponibilité, revalidation serveur de l'offre avant envoi.
 * - Trafic : événements en liste blanche, consentement avant tout identifiant
 *   pseudonyme, déduplication par eventId, heure/jour Europe/Paris.
 * - Rapport quotidien : fenêtre « veille » Europe/Paris robuste aux changements d'heure.
 *
 * Ce module ne calcule AUCUN prix : il compare et recopie ceux du moteur existant.
 */
import { z } from "zod";

import type { WebQuoteCase } from "./tire-web-api";
import type { WebSiteKey } from "./tire-web-sites";

export const V10_VERSION = "v10";
export const COMMERCIAL_VALIDITY_DAYS = 7;
export const COMMERCIAL_MAX_BODY_BYTES = 8192;
export const EVENTS_MAX_BODY_BYTES = 16384;
export const EVENTS_MAX_BATCH = 25;
export const SIGNATURE = "Beaucoup de garages réparent votre voiture. Nous, nous en prenons soin.";
export const REPORT_RECIPIENT = "damien@garagecastillon.fr";
export const REPORT_LOCAL_HOUR = 7;
export const PARIS_TZ = "Europe/Paris";

/* ------------------------------- Expéditeurs ------------------------------- */

export const SITE_SENDERS: Record<WebSiteKey, { from: string; address: string; domain: string; label: string }> = {
  castillon: {
    from: "Garage Castillon <contact@garagecastillon.fr>",
    address: "contact@garagecastillon.fr",
    domain: "garagecastillon.fr",
    label: "Garage Castillon (Castels et Bézenac)",
  },
  lalinde: {
    from: "Damien Digoin Automobile <contact@dda-lalinde.fr>",
    address: "contact@dda-lalinde.fr",
    domain: "dda-lalinde.fr",
    label: "Damien Digoin Automobile (Lalinde)",
  },
};

/** Liste de domaines vérifiés (config) : « a.fr, b.fr » => ["a.fr","b.fr"]. */
export function parseVerifiedDomains(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
}

/** Expéditeur du garage choisi, seulement si son domaine est déclaré vérifié. Aucun repli. */
export function senderFor(site: WebSiteKey, verified: string[]): { ok: true; from: string } | { ok: false; reason: "sender_not_verified" } {
  const s = SITE_SENDERS[site];
  return verified.includes(s.domain) ? { ok: true, from: s.from } : { ok: false, reason: "sender_not_verified" };
}

/* --------------------------- Demande commerciale --------------------------- */

export const PROSPECT_STATUSES = ["nouveau", "a_contacter", "contacte", "rdv_pris", "vendu", "perdu"] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

const PHONE = /^[+0-9 ().-]{6,20}$/;
const base = {
  quoteId: z.string().uuid(),
  tier: z.enum(["entree", "milieu", "haut"]),
  season: z.enum(["ete", "quatre_saisons"]),
  site: z.enum(["castillon", "lalinde"]),
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().regex(PHONE),
};

export const commercialPreviewInput = z.object(base).strict();
export type CommercialPreviewInput = z.infer<typeof commercialPreviewInput>;

export const commercialRequestInput = z
  .object({
    ...base,
    requestId: z.string().uuid(),
    message: z.string().trim().max(500).optional(),
    consent: z.literal(true),
    /** Facultatif : jeton Google Identity (vérifié côté serveur, nom/e-mail uniquement). */
    googleIdToken: z.string().min(20).max(4096).optional(),
    /**
     * Facultatif : contexte analytics strict, envoyé UNIQUEMENT si le visiteur a consenti à la mesure.
     * Sert seulement à relier la demande à son parcours pseudonyme ; n'entre pas dans l'empreinte d'idempotence.
     */
    analytics: z
      .object({
        consent: z.literal(true),
        visitorId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
        sessionId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CommercialRequestInput = z.infer<typeof commercialRequestInput>;

/** Empreinte canonique d'une demande (même requestId + autre contenu => conflit). */
export function canonicalPayload(i: CommercialRequestInput): string {
  return JSON.stringify([i.quoteId, i.tier, i.season, i.site, i.name, i.email.toLowerCase(), i.phone, i.message ?? ""]);
}

export const OFFER_FIELDS = ["brand", "model", "size", "loadIndex", "speedIndex", "quantity", "totalTtcCents", "status"] as const;

/** Compare l'offre acceptée et l'offre revalidée : même référence, dimension, indices, quantité et prix. */
export function compareOffers(accepted: WebQuoteCase, fresh: WebQuoteCase | undefined | null): { same: boolean; changed: string[] } {
  if (!fresh) return { same: false, changed: ["offer"] };
  const changed = OFFER_FIELDS.filter((k) => (accepted[k] ?? null) !== (fresh[k] ?? null));
  return { same: changed.length === 0 && fresh.status === "available", changed: [...changed] };
}

export function validUntil(now: Date): Date {
  return new Date(now.getTime() + COMMERCIAL_VALIDITY_DAYS * 86_400_000);
}

/** Référence lisible : DDA-PN-AAAAMMJJ-XXXXXX (jour Paris + 6 hex du requestId). */
export function commercialReference(now: Date, requestId: string): string {
  return `DDA-PN-${parisParts(now).day.replace(/-/g, "")}-${requestId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

export type ChannelStatus = "sent" | "failed" | "not_configured" | "not_sent";
export type DeliveryOverall = "delivered" | "partial" | "not_delivered";

/** « Enregistré » est distinct de « livré » : jamais de succès d'envoi inventé. */
export function deliveryOverall(client: ChannelStatus, frontOffice: ChannelStatus): DeliveryOverall {
  const n = [client, frontOffice].filter((s) => s === "sent").length;
  return n === 2 ? "delivered" : n === 1 ? "partial" : "not_delivered";
}

export const TIER_LABEL = { entree: "Entrée de gamme", milieu: "Milieu de gamme", haut: "Haut de gamme" } as const;
export const SEASON_LABEL = { ete: "Été", quatre_saisons: "4 saisons" } as const;

export function eurCents(c: number): string {
  const s = (c / 100).toFixed(2).replace(".", ",");
  return `${s.replace(/\B(?=(\d{3})+(?!\d))/g, " ")} €`;
}

/** Libellé du total : « monté » seulement si le montage est réellement inclus dans le devis. */
export function totalLabel(c: Pick<WebQuoteCase, "includedServices">): string {
  return c.includedServices.some((s) => s.code === "montage") ? "Total TTC, montage inclus" : "Total TTC";
}

export function formatParisDate(d: Date): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: PARIS_TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

/* --------------------------------- Trafic --------------------------------- */

export const CLIENT_EVENT_TYPES = ["page_view", "session_start", "quote_generated", "offer_selected"] as const;
/** `request_submitted` n'est produit que par le serveur, à l'enregistrement d'une demande. */
export const SERVER_EVENT_TYPES = ["request_submitted"] as const;
export const PAGES = ["accueil", "devis", "demande", "confirmation", "mentions", "autre"] as const;
export const DEVICES = ["mobile", "tablet", "desktop", "other"] as const;

const PSEUDO = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
const UTM = z.string().max(80);
export const eventItem = z
  .object({
    eventId: z.string().uuid(),
    type: z.enum(CLIENT_EVENT_TYPES),
    occurredAt: z.string().datetime().optional(),
    visitorId: PSEUDO.optional(),
    sessionId: PSEUDO.optional(),
    page: z.enum(PAGES).optional(),
    device: z.enum(DEVICES).optional(),
    utmSource: UTM.optional(),
    utmMedium: UTM.optional(),
    utmCampaign: UTM.optional(),
    width: z.number().int().min(105).max(395).optional(),
    ratio: z.number().int().min(25).max(95).optional(),
    rim: z.number().int().min(10).max(24).optional(),
    quantity: z.union([z.literal(1), z.literal(2), z.literal(4)]).optional(),
    tier: z.enum(["entree", "milieu", "haut"]).optional(),
    season: z.enum(["ete", "quatre_saisons"]).optional(),
    site: z.enum(["castillon", "lalinde"]).optional(),
    /** quoteId serveur (devis généré) : déduplication et lecture de l'offre côté serveur. */
    quoteId: z.string().uuid().optional(),
  })
  .strict();

export const eventsBatch = z
  .object({
    consent: z.object({ analytics: z.boolean() }).strict(),
    events: z.array(eventItem).min(1).max(EVENTS_MAX_BATCH),
  })
  .strict();
export type EventsBatch = z.infer<typeof eventsBatch>;

/** UTM : jeton court [a-z0-9_.-], sinon ignoré (aucune URL ni texte libre). */
export function sanitizeUtm(v: string | undefined): string | null {
  if (!v) return null;
  const t = v.trim().toLowerCase();
  return /^[a-z0-9_.-]{1,40}$/.test(t) ? t : null;
}

export function parisParts(d: Date): { day: string; hour: number; weekday: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: PARIS_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p['weekday'] as string) + 1;
  return { day: `${p['year']}-${p['month']}-${p['day']}`, hour: Number(p['hour']), weekday: wd };
}

export type EventRow = {
  event_id: string; type: string; occurred_at: string; consent: boolean;
  visitor_id: string | null; session_id: string | null; page: string | null; device: string | null;
  utm_source: string | null; utm_medium: string | null; utm_campaign: string | null;
  size: string | null; quantity: number | null; tier: string | null; season: string | null; site_key: string | null;
  paris_day: string; paris_hour: number; paris_weekday: number;
  /** Devis serveur associé (facultatif). */
  quote_id?: string | null;
  /** Marque/taille relues dans l'offre serveur ; jamais du texte client libre. */
  offer_brand?: string | null;
  offer_verified?: boolean;
};

/**
 * Normalise un lot validé. Sans consentement, les identifiants pseudonymes sont
 * supprimés (l'événement reste compté anonymement). Horodatage client borné
 * (24 h passées, 5 min futures), sinon heure serveur.
 */
export function normalizeEvents(b: EventsBatch, now: Date): EventRow[] {
  const ok = b.consent.analytics;
  const seen = new Set<string>();
  const out: EventRow[] = [];
  for (const e of b.events) {
    if (seen.has(e.eventId)) continue;
    seen.add(e.eventId);
    let at = now;
    if (e.occurredAt) {
      const t = new Date(e.occurredAt);
      if (t.getTime() <= now.getTime() + 300_000 && t.getTime() >= now.getTime() - 86_400_000) at = t;
    }
    const pp = parisParts(at);
    const size = e.width && e.ratio && e.rim ? `${e.width}/${e.ratio}R${e.rim}` : null;
    out.push({
      event_id: e.eventId, type: e.type, occurred_at: at.toISOString(), consent: ok,
      visitor_id: ok ? e.visitorId ?? null : null, session_id: ok ? e.sessionId ?? null : null,
      page: e.page ?? null, device: e.device ?? null,
      utm_source: sanitizeUtm(e.utmSource), utm_medium: sanitizeUtm(e.utmMedium), utm_campaign: sanitizeUtm(e.utmCampaign),
      size, quantity: e.quantity ?? null, tier: e.tier ?? null, season: e.season ?? null, site_key: e.site ?? null,
      paris_day: pp.day, paris_hour: pp.hour, paris_weekday: pp.weekday,
      quote_id: e.quoteId ?? null, offer_brand: null, offer_verified: false,
    });
  }
  return out;
}

/* ------------------------------- Agrégation ------------------------------- */

export type RequestLite = { created_at: string; site_key: string; prospect_status: string; delivery_status: string };

export function aggregateTraffic(events: EventRow[], requests: RequestLite[]) {
  const count = <K extends string>(rows: EventRow[], f: (r: EventRow) => K | null) => {
    const m: Record<string, number> = {};
    for (const r of rows) {
      const k = f(r);
      if (k != null) m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  };
  const consented = events.filter((e) => e.consent);
  const pageViews = events.filter((e) => e.type === "page_view");
  const sessionsAll = events.filter((e) => e.type === "session_start");
  const quotes = events.filter((e) => e.type === "quote_generated");
  const selected = events.filter((e) => e.type === "offer_selected");
  const consentedSessions = new Set(consented.map((e) => e.session_id).filter(Boolean)).size;
  return {
    totals: {
      events: events.length,
      pageViews: pageViews.length,
      sessionStarts: sessionsAll.length,
      quotes: quotes.length,
      offerSelected: selected.length,
      requests: requests.length,
    },
    /** Visiteurs/sessions distincts : uniquement parmi les événements consentis. */
    consentCoverage: {
      consentedEvents: consented.length,
      totalEvents: events.length,
      ratio: events.length ? consented.length / events.length : 0,
      distinctVisitorsConsented: new Set(consented.map((e) => e.visitor_id).filter(Boolean)).size,
      distinctSessionsConsented: consentedSessions,
    },
    byHour: count(pageViews, (r) => String(r.paris_hour)),
    byWeekday: count(pageViews, (r) => String(r.paris_weekday)),
    bySource: count(pageViews, (r) => r.utm_source ?? "direct"),
    byDevice: count(pageViews, (r) => r.device ?? "inconnu"),
    bySize: count(quotes, (r) => r.size),
    byTier: count(selected, (r) => r.tier),
    requestsBySite: requests.reduce<Record<string, number>>((m, r) => ((m[r.site_key] = (m[r.site_key] ?? 0) + 1), m), {}),
    soldBySite: requests
      .filter((r) => r.prospect_status === "vendu")
      .reduce<Record<string, number>>((m, r) => ((m[r.site_key] = (m[r.site_key] ?? 0) + 1), m), {}),
  };
}

/* --------------------------- Rapport quotidien --------------------------- */

/** Décalage Paris−UTC (minutes) à l'instant donné. */
function parisOffsetMin(at: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: PARIS_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(Number(p['year']), Number(p['month']) - 1, Number(p['day']), Number(p['hour']), Number(p['minute']));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Minuit Europe/Paris du jour AAAA-MM-JJ, exprimé en UTC. */
export function parisMidnightUtc(day: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const guess = new Date(Date.UTC(y, m - 1, d));
  return new Date(guess.getTime() - parisOffsetMin(guess) * 60000);
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * Le planificateur peut appeler toutes les heures (UTC) : n'agit qu'à 7 h Paris.
 * Rapport = la veille Paris [00:00, 24:00[ (23 h ou 25 h les jours de changement d'heure).
 */
export function dailyReportWindow(now: Date): { shouldRun: boolean; reportDate: string; start: Date; end: Date } {
  const pp = parisParts(now);
  const reportDate = addDays(pp.day, -1);
  return { shouldRun: pp.hour === REPORT_LOCAL_HOUR, reportDate, start: parisMidnightUtc(reportDate), end: parisMidnightUtc(pp.day) };
}

export function dailyReportIdempotencyKey(reportDate: string): string {
  return `tyres-daily-report-${reportDate}`;
}

/* ------------------------- Correctifs revue V10 ------------------------- */

/**
 * Destinataires Front Office VALIDÉS (gérant). Jamais remplacés par sites.contact_email :
 * une divergence est seulement signalée (fo_recipient_mismatch).
 */
export const FRONT_OFFICE_RECIPIENTS: Record<WebSiteKey, string> = {
  castillon: "contact@garagecastillon.fr",
  lalinde: "contact@dda-lalinde.fr",
};

/**
 * true si l'indice de charge de l'offre est CONNU et inférieur à la charge demandée.
 * Indice double (« 94/92 ») : la valeur la plus faible fait foi. Inconnu => false (réserve, pas refus).
 */
export function loadBelowRequested(offerLoad: string | number | null | undefined, requested: number | null | undefined): boolean {
  if (requested == null || !Number.isFinite(requested)) return false;
  const nums = String(offerLoad ?? "").match(/\d{2,3}/g)?.map(Number) ?? [];
  if (!nums.length) return false;
  return Math.min(...nums) < requested;
}

/** Lecture paginée (plafond 1000/requête côté API) avec plafond dur explicite : jamais de troncature silencieuse. */
export const STATS_PAGE_SIZE = 1000;
export const STATS_MAX_ROWS = 50_000;
export async function fetchAllPages<T>(
  page: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>,
  opts: { pageSize?: number; maxRows?: number } = {},
): Promise<{ rows: T[]; truncated: boolean }> {
  const size = opts.pageSize ?? STATS_PAGE_SIZE;
  const max = opts.maxRows ?? STATS_MAX_ROWS;
  const rows: T[] = [];
  for (let from = 0; from < max; from += size) {
    const { data, error } = await page(from, Math.min(from + size, max) - 1);
    if (error) throw new Error("page");
    const d = data ?? [];
    rows.push(...d);
    if (d.length < Math.min(size, max - from)) return { rows, truncated: false };
  }
  // Plafond atteint : vérifier s'il reste des lignes.
  const { data, error } = await page(max, max);
  if (error) throw new Error("page");
  return { rows, truncated: (data ?? []).length > 0 };
}

/** Demande sans réponse finale considérée bloquée après ce délai (reprise administrative). */
export const REQUEST_STALE_MS = 10 * 60_000;
/** Rapport « running » considéré abandonné après ce délai. */
export const REPORT_STALE_MS = 30 * 60_000;

/**
 * Clé d'envoi du rapport : conservée si l'issue précédente est inconnue (running abandonné),
 * nouvelle seulement après un échec CONFIRMÉ. Évite double envoi tout en permettant le réessai.
 */
export function reportSendKey(reportDate: string, previous: "none" | "failed" | "stale", attempt: number, prevKey: string | null): string {
  const base = dailyReportIdempotencyKey(reportDate);
  if (previous === "failed") return `${base}-r${attempt}`;
  if (previous === "stale") return prevKey ?? base;
  return base;
}

/* ----------------------- Analytics V10.1 : cohorte consentie ----------------------- */

type StoredQuoteLite = { request: { size: string; quantity: number }; cases: { tier: string; season: string; status: string; brand: string | null }[] };

/**
 * Enrichit un événement depuis le devis SERVEUR (quoteId) : taille/quantité du devis, marque de l'offre
 * choisie (tier+saison). Les dimensions envoyées par le client sont remplacées. Sans devis lisible :
 * dimensions client conservées, offer_verified=false.
 */
export function enrichFromQuote(row: EventRow, quote: StoredQuoteLite | null): EventRow {
  if (!quote || !row.quote_id) return { ...row, offer_verified: false, offer_brand: null };
  const c = row.tier && row.season ? quote.cases.find((x) => x.tier === row.tier && x.season === row.season && x.status === "available") : undefined;
  return {
    ...row,
    size: quote.request.size,
    quantity: quote.request.quantity,
    offer_brand: row.type === "offer_selected" ? c?.brand ?? null : null,
    offer_verified: row.type === "offer_selected" ? !!c : true,
  };
}

export type RequestLiteV2 = RequestLite & { quote_id?: string | null };

const rate = (num: number, den: number): number | null => (den > 0 ? num / den : null);

/** Les 7 derniers jours Paris (inclus aujourd'hui), du plus ancien au plus récent. */
export function lastParisDays(now: Date, n = 7): string[] {
  const today = parisParts(now).day;
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  return Array.from({ length: n }, (_, k) => new Date(Date.UTC(y, m - 1, d - (n - 1 - k))).toISOString().slice(0, 10));
}

/**
 * Entonnoir sur la SEULE cohorte consentie (visiteurs pseudonymes) ; demandes globales à part.
 * Un taux vaut null (« Non calculable ») si les champs de corrélation manquent.
 */
export function consentedFunnel(events: EventRow[]) {
  const c = events.filter((e) => e.consent && e.visitor_id);
  const visitors = new Set(c.filter((e) => e.type === "page_view" || e.type === "session_start").map((e) => e.visitor_id!));
  const quoteEv = c.filter((e) => e.type === "quote_generated");
  const quoteVisitors = new Set(quoteEv.map((e) => e.visitor_id!));
  const reqEv = c.filter((e) => e.type === "request_submitted");
  const reqVisitors = new Set(reqEv.map((e) => e.visitor_id!));
  const quoteToReqVisitors = [...quoteVisitors].filter((v) => reqVisitors.has(v)).length;
  // Choix d'offre : dédupliqués par devis (répéter le choix sur le même devis n'est pas un nouvel abandon).
  const sel = c.filter((e) => e.type === "offer_selected");
  const selWithQuote = sel.filter((e) => e.quote_id);
  const selectedQuotes = new Set(selWithQuote.map((e) => e.quote_id!));
  const requestedQuotes = new Set(reqEv.map((e) => e.quote_id).filter(Boolean) as string[]);
  const correlationComplete = sel.length > 0 && selWithQuote.length === sel.length;
  const abandonedSelections = correlationComplete ? [...selectedQuotes].filter((q) => !requestedQuotes.has(q)).length : null;
  return {
    visitors: visitors.size,
    quoteVisitors: [...quoteVisitors].filter((v) => visitors.has(v)).length,
    requestVisitors: reqVisitors.size,
    selectedQuotes: correlationComplete ? selectedQuotes.size : null,
    visitToQuote: rate([...quoteVisitors].filter((v) => visitors.has(v)).length, visitors.size),
    quoteToRequest: rate(quoteToReqVisitors, quoteVisitors.size),
    visitToRequest: rate([...reqVisitors].filter((v) => visitors.has(v)).length, visitors.size),
    abandonedSelections,
  };
}

/** Série par date Paris (7 jours) : trafic tous événements, demandes enregistrées vs e-mails acceptés. */
export function dailySeries(events: EventRow[], requests: RequestLite[], days: string[]) {
  return days.map((day) => {
    const ev = events.filter((e) => e.paris_day === day);
    const rq = requests.filter((r) => parisParts(new Date(r.created_at)).day === day);
    return {
      day,
      pageViews: ev.filter((e) => e.type === "page_view").length,
      quotes: ev.filter((e) => e.type === "quote_generated").length,
      requestsRecorded: rq.length,
      requestsDelivered: rq.filter((r) => r.delivery_status === "delivered").length,
    };
  });
}

export function aggregateTrafficV2(events: EventRow[], requests: RequestLite[], now: Date) {
  const base = aggregateTraffic(events, requests);
  const verifiedSel = events.filter((e) => e.type === "offer_selected" && e.offer_verified && e.offer_brand);
  const byBrand: Record<string, number> = {};
  for (const e of verifiedSel) byBrand[e.offer_brand!] = (byBrand[e.offer_brand!] ?? 0) + 1;
  return {
    ...base,
    requestsGlobal: { recorded: requests.length, delivered: requests.filter((r) => r.delivery_status === "delivered").length },
    cohort: consentedFunnel(events),
    daily: dailySeries(events, requests, lastParisDays(now)),
    byOfferBrandVerified: byBrand,
  };
}

/* --------------------------------- CRM prospects --------------------------------- */

/** Changement de statut autorisé : statut connu, différent de l'actuel. Droits vérifiés en base (RPC). */
export function canSetProspectStatus(current: string, next: string): boolean {
  return (PROSPECT_STATUSES as readonly string[]).includes(next) && current !== next;
}
export const PROSPECT_LABEL: Record<ProspectStatus, string> = {
  nouveau: "Nouveau", a_contacter: "À contacter", contacte: "Contacté", rdv_pris: "RDV pris", vendu: "Vendu", perdu: "Perdu",
};
