/**
 * Reporting DDA Pneus — gestionnaires serveur injectables (testés sans réseau).
 *
 *  - POST/OPTIONS /api/public/tyres/events : mesure d'audience, active SEULEMENT si
 *    tyre_rpt_settings.events_enabled (indépendant de TYRES_V10_ENABLED).
 *  - POST /api/public/tyres/reporting-daily : appelé par pg_cron (horaire UTC), bearer
 *    vérifié par RPC service_role contre un secret Vault ; rapport unique par date Paris.
 *  - Journal technique contact-request : jamais bloquant pour l'e-mail.
 * Aucune écriture CRM/prospect, aucun PDF, aucun recalcul Top prix.
 */
import { corsHeaders, originAllowed, type WebQuoteCase, type WebQuoteConfig } from "./tire-web-api";
import { clientIp, err, json, readBounded, sha } from "./tire-web-facade.server";
import { enrichFromQuote, fetchAllPages, parisParts, totalLabel, type EventRow } from "./tire-v10";
import {
  RPT_EVENTS_MAX_BODY, RPT_MAX_ATTEMPTS, RPT_RECIPIENT, buildDailyReport, contactsCsv, isTestContact,
  normalizeRptEvents, renderReportHtml, reportSendKey, requestEventId, rptEventsBatch, schedulerDecision,
  type ContactAnalytics, type ContactLogRow, type ContactLogStatus, type CounterRow, type QuoteLite, type ReportingSettings, type RptEventRow,
} from "./tyre-reporting";

export const RPT_EVENTS_QUOTA_IP_PER_10MIN = 120;
export const RPT_REPORT_STALE_MS = 30 * 60_000;

/* --------------------------------- Événements --------------------------------- */

export type RptEventsDeps = {
  loadConfig: () => Promise<WebQuoteConfig | null>;
  loadSettings: () => Promise<ReportingSettings | null>;
  quotaHit: (bucket: string, windowSeconds: number, limit: number) => Promise<boolean>;
  insertEvents: (rows: RptEventRow[]) => Promise<number>;
  /** Lecture des devis SERVEUR (cases) par id — jamais le moteur, jamais de prix d'achat. */
  loadQuotes?: (ids: string[]) => Promise<QuoteLite[]>;
  now: () => Date;
};

/** Marque/dimension relues dans le devis serveur (quoteId + gamme + saison). Échec de lecture = non vérifié. */
export async function enrichRptRows(rows: RptEventRow[], loadQuotes?: (ids: string[]) => Promise<QuoteLite[]>): Promise<RptEventRow[]> {
  const ids = [...new Set(rows.map((r) => r.quote_id).filter(Boolean) as string[])];
  if (!loadQuotes || !ids.length) return rows.map((r) => ({ ...r, offer_brand: null, offer_verified: false }));
  let quotes: QuoteLite[] = [];
  try {
    quotes = await Promise.race([loadQuotes(ids), new Promise<QuoteLite[]>((res) => setTimeout(() => res([]), 2000))]);
  } catch {
    quotes = [];
  }
  const byId = new Map(quotes.map((q) => [q.id, q]));
  return rows.map((r) => {
    const q = r.quote_id ? byId.get(r.quote_id) : undefined;
    if (!q || !q.request?.size || !q.cases) return { ...r, offer_brand: null, offer_verified: false };
    return { ...enrichFromQuote(r, { request: { size: q.request.size, quantity: q.request.quantity ?? 0 }, cases: q.cases }), is_test: r.is_test };
  });
}

const unavailable = () => err("service_unavailable", "Service momentanément indisponible.");

export async function handleRptEventsOptions(req: Request, deps: Pick<RptEventsDeps, "loadConfig">): Promise<Response> {
  const origin = req.headers.get("origin");
  let allowed: string[] | null = null;
  try {
    allowed = (await deps.loadConfig())?.allowed_origins ?? null;
  } catch {
    allowed = null;
  }
  return new Response(null, { status: originAllowed(origin, allowed) ? 204 : 403, headers: corsHeaders(origin, allowed) });
}

export async function handleRptEvents(req: Request, deps: RptEventsDeps): Promise<Response> {
  const origin = req.headers.get("origin");
  let cfg: WebQuoteConfig | null, settings: ReportingSettings | null;
  try {
    [cfg, settings] = await Promise.all([deps.loadConfig(), deps.loadSettings()]);
  } catch {
    return json(503, unavailable());
  }
  const cors = corsHeaders(origin, cfg?.allowed_origins ?? null);
  if (!cfg || !settings?.events_enabled) return json(503, unavailable(), cors);
  if (!originAllowed(origin, cfg.allowed_origins)) return json(403, err("origin_not_allowed", "Origine non autorisée."), cors);
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json"))
    return json(415, err("unsupported_media_type", "Content-Type application/json requis."), cors);
  const text = await readBounded(req, RPT_EVENTS_MAX_BODY);
  if (text == null) return json(413, err("payload_too_large", "Requête trop volumineuse."), cors);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json(400, err("invalid_json", "JSON invalide."), cors);
  }
  const parsed = rptEventsBatch.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "body")))];
    return json(400, { ...err("invalid_request", "Événements invalides."), fields }, cors);
  }
  const now = deps.now();
  try {
    const ipHash = await sha(`${now.toISOString().slice(0, 10)}|${clientIp(req)}`);
    if (!(await deps.quotaHit(`rpt-ev:${ipHash}`, 600, RPT_EVENTS_QUOTA_IP_PER_10MIN)))
      return json(429, err("rate_limited", "Trop d'événements."), cors, { "Retry-After": "600" });
  } catch {
    return json(503, unavailable(), cors);
  }
  if (!parsed.data.consent.analytics) return json(202, { accepted: 0, inserted: 0, duplicates: 0, ignored: parsed.data.events.length }, cors);
  const rows = await enrichRptRows(normalizeRptEvents(parsed.data, now, settings), deps.loadQuotes);
  try {
    const inserted = await deps.insertEvents(rows);
    return json(202, { accepted: rows.length, inserted, duplicates: rows.length - inserted }, cors);
  } catch {
    return json(503, unavailable(), cors);
  }
}

/* ------------------------------ Journal contact ------------------------------ */

export type ContactLogDeps = {
  loadSettings: () => Promise<ReportingSettings | null>;
  /** INSERT … ON CONFLICT (request_id) DO UPDATE attempts+1 ; renvoie true si nouvelle demande. */
  begin: (row: ContactLogRow) => Promise<boolean>;
  /** Ne rétrograde jamais un statut « sent ». */
  finish: (requestId: string, status: ContactLogStatus, errorCode: string | null) => Promise<void>;
  insertEvents: (rows: RptEventRow[]) => Promise<number>;
};

export type ContactLogInput = {
  requestId: string; quoteId: string; site: "castillon" | "lalinde"; tier: string; season: string;
  name: string; email: string; phone: string; message?: string | undefined; analytics?: ContactAnalytics | undefined;
};

/** Journal minimal : chaque appel est isolé, borné à 1,5 s, et ne lève jamais. */
export function contactLogger(deps: ContactLogDeps | null | undefined, now: () => Date) {
  let settings: ReportingSettings | null = null;
  const safe = async <T>(f: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await Promise.race([f(), new Promise<undefined>((r) => setTimeout(() => r(undefined), 1500))]);
    } catch {
      console.warn("[tyres-contact] log_failed");
      return undefined;
    }
  };
  return {
    async start(i: ContactLogInput, offer: WebQuoteCase) {
      if (!deps) return;
      settings = (await safe(() => deps.loadSettings())) ?? null;
      if (!settings?.contact_log_enabled) return;
      const s = settings;
      await safe(() =>
        deps.begin({
          request_id: i.requestId, created_at: now().toISOString(), site_key: i.site, status: "sending", attempts: 1, error_code: null,
          is_test: isTestContact(i, s), name: i.name, email: i.email, phone: i.phone, message: i.message ?? null,
          quote_id: i.quoteId, tier: i.tier, season: i.season, brand: offer.brand, model: offer.model, size: offer.size,
          load_index: offer.loadIndex, speed_index: offer.speedIndex, quantity: offer.quantity, total_ttc_cents: offer.totalTtcCents,
          total_label: totalLabel(offer), visitor_id: i.analytics?.visitorId ?? null,
        }),
      );
    },
    async finish(i: ContactLogInput, offer: WebQuoteCase | null, status: ContactLogStatus, errorCode: string | null) {
      if (!deps || !settings?.contact_log_enabled) return;
      const s = settings;
      await safe(() => deps.finish(i.requestId, status, errorCode));
      // Événement de conversion : seulement si consenti, sans nom/e-mail/téléphone, id déterministe (rejeu = doublon ignoré).
      if (status === "sent" && i.analytics && s.events_enabled) {
        const at = now();
        const pp = parisParts(at);
        const row: EventRow = {
          event_id: await requestEventId(i.requestId), type: "request_submitted", occurred_at: at.toISOString(), consent: true,
          visitor_id: i.analytics.visitorId, session_id: i.analytics.sessionId ?? null, page: null, device: null,
          utm_source: null, utm_medium: null, utm_campaign: null, size: offer?.size ?? null, quantity: offer?.quantity ?? null,
          tier: i.tier, season: i.season, site_key: i.site, paris_day: pp.day, paris_hour: pp.hour, paris_weekday: pp.weekday,
          quote_id: i.quoteId, offer_brand: offer?.brand ?? null, offer_verified: true,
        };
        await safe(() => deps.insertEvents([{ ...row, is_test: isTestContact(i, s) || s.test_visitor_ids.includes(i.analytics!.visitorId) }]));
      }
    },
  };
}

/* ------------------------------ Rapport quotidien ------------------------------ */

export type ReportClaim =
  | { claimed: true; attempt: number; previous: "none" | "failed" | "stale"; prevKey: string | null }
  | { claimed: false; reason: "already_sent" | "running" | "max_attempts" };

export type ReportSnapshot = { subject: string; html: string; csv: string | null; counters: Record<string, number> };

export type ReportDeps = {
  verifyToken: (token: string) => Promise<boolean>;
  loadSettings: () => Promise<ReportingSettings | null>;
  claim: (reportDate: string, staleMs: number, maxAttempts: number) => Promise<ReportClaim>;
  /** Snapshot figé (HTML/CSV/compteurs) persisté AVANT envoi ; réutilisé tel quel à chaque nouvel essai. */
  loadSnapshot: (reportDate: string) => Promise<ReportSnapshot | null>;
  saveSnapshot: (reportDate: string, key: string, snap: ReportSnapshot) => Promise<void>;
  finish: (reportDate: string, status: "sent" | "failed", errorCode: string | null, providerId: string | null) => Promise<void>;
  loadEvents: (start: Date, end: Date) => Promise<{ rows: RptEventRow[]; truncated: boolean }>;
  loadContacts: (start: Date, end: Date) => Promise<{ rows: ContactLogRow[]; truncated: boolean }>;
  loadQuotes: (start: Date, end: Date) => Promise<{ rows: QuoteLite[]; truncated: boolean }>;
  loadHistory: (from: string, to: string) => Promise<CounterRow[]>;
  saveCounters: (reportDate: string, counters: Record<string, number>) => Promise<void>;
  sendEmail: (m: { to: string; subject: string; html: string; idempotencyKey: string; attachments: { filename: string; content: string }[] }) => Promise<{ ok: boolean; id?: string | undefined; status: number }>;
  now: () => Date;
};

const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

export async function handleDailyReportCron(req: Request, deps: ReportDeps): Promise<Response> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  let ok = false;
  try {
    ok = token.length >= 32 && (await deps.verifyToken(token));
  } catch {
    ok = false;
  }
  if (!ok) return json(401, err("unauthorized", "Non autorisé."));

  const d = schedulerDecision(deps.now());
  if (!d.act) return json(200, { status: "skipped", reason: "outside_window" });
  let settings: ReportingSettings | null;
  try {
    settings = await deps.loadSettings();
  } catch {
    return json(503, unavailable());
  }
  if (!settings?.report_enabled) return json(200, { status: "skipped", reason: "report_disabled" });

  let claim: ReportClaim;
  try {
    claim = await deps.claim(d.reportDate, RPT_REPORT_STALE_MS, RPT_MAX_ATTEMPTS);
  } catch {
    return json(503, unavailable());
  }
  if (!claim.claimed) return json(200, { status: "skipped", reason: claim.reason, reportDate: d.reportDate });
  const key = reportSendKey(d.reportDate, claim.previous, claim.attempt, claim.prevKey).replace("tyres-daily-report-", "tyres-rpt-");

  let snap: ReportSnapshot | null;
  try {
    snap = claim.previous === "none" ? null : await deps.loadSnapshot(d.reportDate);
  } catch {
    snap = null;
  }
  if (!snap && claim.previous === "stale") {
    // Issue précédente inconnue : renvoyer un contenu différent sous la même clé est interdit.
    await deps.finish(d.reportDate, "failed", "snapshot_missing", null).catch(() => undefined);
    return json(503, { status: "failed", reason: "snapshot_missing", reportDate: d.reportDate });
  }
  if (!snap) {
    try {
      const [ev, ct, qt, hist] = await Promise.all([
        deps.loadEvents(d.start, d.end),
        deps.loadContacts(d.start, d.end),
        deps.loadQuotes(d.start, d.end),
        deps.loadHistory(shift(d.reportDate, -7), shift(d.reportDate, -1)),
      ]);
      const truncated = ev.truncated || ct.truncated || qt.truncated;
      const report = buildDailyReport({ reportDate: d.reportDate, start: d.start, end: d.end, settings, events: ev.rows, contacts: ct.rows, quotes: qt.rows, history: hist });
      const csv = contactsCsv([...report.contacts.rows, ...report.tests.contacts]);
      snap = {
        subject: `DDA Pneus — rapport quotidien du ${d.reportDate}`,
        html: renderReportHtml(report).replace("</h2>", truncated ? "</h2><p style=\"color:#a00\"><b>Attention : volume plafonné, chiffres tronqués.</b></p>" : "</h2>"),
        csv: csv.split("\r\n").length > 1 ? csv : null,
        counters: report.counters,
      };
    } catch {
      await deps.finish(d.reportDate, "failed", "build_failed", null).catch(() => undefined);
      return json(503, { status: "failed", reason: "build_failed", reportDate: d.reportDate });
    }
  }
  try {
    await deps.saveSnapshot(d.reportDate, key, snap);
  } catch {
    // Rien n'est envoyé sans snapshot persistant.
    await deps.finish(d.reportDate, "failed", "snapshot_save_failed", null).catch(() => undefined);
    return json(503, { status: "failed", reason: "snapshot_save_failed", reportDate: d.reportDate });
  }

  let r: Awaited<ReturnType<ReportDeps["sendEmail"]>>;
  try {
    r = await deps.sendEmail({
      to: RPT_RECIPIENT, subject: snap.subject, html: snap.html, idempotencyKey: key,
      attachments: snap.csv ? [{ filename: `dda-pneus-demandes-${d.reportDate}.csv`, content: b64(snap.csv) }] : [],
    });
  } catch {
    // Issue inconnue : « running » conservé ; reprise après 30 min, même clé + même snapshot.
    console.warn("[tyres-report] send_exception");
    return json(502, { status: "unknown", reportDate: d.reportDate });
  }
  if (r.ok && r.id) {
    await deps.saveCounters(d.reportDate, snap.counters).catch(() => console.warn("[tyres-report] counters_failed"));
    await deps.finish(d.reportDate, "sent", null, r.id).catch(() => console.warn("[tyres-report] finish_failed"));
    return json(200, { status: "sent", reportDate: d.reportDate, attempt: claim.attempt });
  }
  console.warn(`[tyres-report] send_failed status=${r.status}`);
  if (r.status === 0 || r.status >= 500) {
    // 5xx / pas de réponse : peut-être accepté => issue inconnue, même clé/snapshot plus tard.
    return json(502, { status: "unknown", reportDate: d.reportDate, attempt: claim.attempt });
  }
  await deps.finish(d.reportDate, "failed", `provider_${r.status}`, null).catch(() => undefined);
  return json(502, { status: "failed", reportDate: d.reportDate, attempt: claim.attempt });
}

function shift(day: string, n: number) {
  const [y, m, dd] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
}

/* ------------------------------ Dépendances réelles ------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any; rpc: (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };

async function admin(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Db;
}

async function loadSettingsFrom(db: Db): Promise<ReportingSettings | null> {
  const { data, error } = await db.from("tyre_rpt_settings").select("events_enabled, report_enabled, contact_log_enabled, instrumentation_started_at, retention_days, test_emails, test_email_domains, test_visitor_ids").eq("id", 1).maybeSingle();
  if (error) throw new Error("settings");
  return (data ?? null) as ReportingSettings | null;
}

const toDbEvent = (r: RptEventRow) => ({
  event_id: r.event_id, type: r.type, occurred_at: r.occurred_at, consent: r.consent, visitor_id: r.visitor_id, session_id: r.session_id,
  page: r.page, device: r.device, utm_source: r.utm_source, utm_medium: r.utm_medium, utm_campaign: r.utm_campaign, size: r.size,
  quantity: r.quantity, tier: r.tier, season: r.season, site_key: r.site_key, paris_day: r.paris_day, paris_hour: r.paris_hour,
  paris_weekday: r.paris_weekday, quote_id: r.quote_id ?? null, offer_brand: r.offer_brand ?? null, offer_verified: !!r.offer_verified, is_test: r.is_test,
});

async function insertEventsInto(db: Db, rows: RptEventRow[]): Promise<number> {
  if (!rows.length) return 0;
  const { data, error } = await db.from("tyre_rpt_events").upsert(rows.map(toDbEvent), { onConflict: "event_id", ignoreDuplicates: true }).select("event_id");
  if (error) throw new Error("insert");
  return (data ?? []).length;
}

export async function realRptEventsDeps(loadConfig: () => Promise<WebQuoteConfig | null>): Promise<RptEventsDeps> {
  const db = await admin();
  return {
    loadConfig,
    loadSettings: () => loadSettingsFrom(db),
    quotaHit: async (bucket, w, l) => {
      const { data, error } = await db.rpc("tire_web_quota_hit", { p_bucket: bucket, p_window_seconds: w, p_limit: l });
      if (error) throw new Error("quota");
      return data === true;
    },
    insertEvents: (rows) => insertEventsInto(db, rows),
    loadQuotes: async (ids) => {
      const out: QuoteLite[] = [];
      for (let i = 0; i < ids.length; i += 50) {
        const { data, error } = await db.from("tire_web_quotes").select("id, created_at, request, cases").in("id", ids.slice(i, i + 50));
        if (error) throw new Error("quotes");
        out.push(...((data ?? []) as QuoteLite[]));
      }
      return out;
    },
    now: () => new Date(),
  };
}

export async function realContactLogDeps(): Promise<ContactLogDeps> {
  const db = await admin();
  return {
    loadSettings: () => loadSettingsFrom(db),
    begin: async (row) => {
      const { data, error } = await db.rpc("tyre_rpt_contact_begin", { p_row: row });
      if (error) throw new Error("begin");
      return data === true;
    },
    finish: async (id, status, code) => {
      const { error } = await db.rpc("tyre_rpt_contact_finish", { p_request_id: id, p_status: status, p_error_code: code });
      if (error) throw new Error("finish");
    },
    insertEvents: (rows) => insertEventsInto(db, rows),
  };
}

export async function realReportDeps(): Promise<ReportDeps> {
  const db = await admin();
  const { sendEmailWithAttachments } = await import("./email.server");
  // Ordre stable : horodatage puis clé primaire (aucune ligne sautée/dupliquée entre pages).
  const range = <T>(table: string, cols: string, col: string, key: string, start: Date, end: Date) =>
    fetchAllPages<T>((from, to) => db.from(table).select(cols).gte(col, start.toISOString()).lt(col, end.toISOString()).order(col, { ascending: true }).order(key, { ascending: true }).range(from, to));
  return {
    verifyToken: async (token) => {
      const { data, error } = await db.rpc("tyre_rpt_verify_cron_token", { p_token: token });
      if (error) throw new Error("verify");
      return data === true;
    },
    loadSettings: () => loadSettingsFrom(db),
    claim: async (date, staleMs, max) => {
      const { data, error } = await db.rpc("tyre_rpt_claim_report", { p_report_date: date, p_stale_seconds: Math.round(staleMs / 1000), p_max_attempts: max });
      if (error) throw new Error("claim");
      const r = data as { claimed: boolean; attempt?: number; previous?: string; prev_key?: string | null; reason?: string };
      return r.claimed
        ? { claimed: true, attempt: r.attempt ?? 1, previous: (r.previous ?? "none") as "none" | "failed" | "stale", prevKey: r.prev_key ?? null }
        : { claimed: false, reason: (r.reason ?? "running") as "already_sent" | "running" | "max_attempts" };
    },
    loadSnapshot: async (date) => {
      const { data, error } = await db.from("tyre_rpt_daily_reports").select("snapshot_subject, snapshot_html, snapshot_csv, snapshot_counters").eq("report_date", date).maybeSingle();
      if (error) throw new Error("snapshot");
      if (!data?.snapshot_html || !data.snapshot_subject) return null;
      return { subject: data.snapshot_subject, html: data.snapshot_html, csv: data.snapshot_csv ?? null, counters: data.snapshot_counters ?? {} };
    },
    saveSnapshot: async (date, key, snap) => {
      const { error } = await db.from("tyre_rpt_daily_reports").update({
        send_key: key, snapshot_subject: snap.subject, snapshot_html: snap.html, snapshot_csv: snap.csv, snapshot_counters: snap.counters,
      }).eq("report_date", date);
      if (error) throw new Error("snapshot");
    },
    finish: async (date, status, code, providerId) => {
      const { error } = await db.from("tyre_rpt_daily_reports").update({ status, error_code: code, provider_id: providerId, finished_at: new Date().toISOString() }).eq("report_date", date);
      if (error) throw new Error("finish");
    },
    loadEvents: (s, e) => range<RptEventRow>("tyre_rpt_events", "*", "occurred_at", "event_id", s, e),
    loadContacts: (s, e) => range<ContactLogRow>("tyre_rpt_contact_log", "*", "created_at", "request_id", s, e),
    loadQuotes: (s, e) => range<QuoteLite>("tire_web_quotes", "id, created_at, request, cases", "created_at", "id", s, e),
    loadHistory: async (from, to) => {
      const { data, error } = await db.from("tyre_rpt_daily_counters").select("report_date, metric, value").gte("report_date", from).lte("report_date", to).limit(1000);
      if (error) throw new Error("history");
      return (data ?? []) as CounterRow[];
    },
    saveCounters: async (date, counters) => {
      const rows = Object.entries(counters).map(([metric, value]) => ({ report_date: date, metric, value }));
      const { error } = await db.from("tyre_rpt_daily_counters").upsert(rows, { onConflict: "report_date,metric" });
      if (error) throw new Error("counters");
    },
    sendEmail: (m) => sendEmailWithAttachments(m),
    now: () => new Date(),
  };
}
