/**
 * Reporting quotidien DDA Pneus (site public) — règles PURES, testables sans réseau.
 *
 * Indépendant de TYRES_V10_ENABLED : aucun PDF, aucun CRM, aucun recalcul Top prix.
 * Tables dédiées `tyre_rpt_*` (docs/migrations-pending/reporting-contact.sql).
 * Réutilise les règles de date Paris / DST et la clé d'envoi du rapport V10.
 */
import { z } from "zod";
import {
  CLIENT_EVENT_TYPES, DEVICES, PAGES, PARIS_TZ, REPORT_LOCAL_HOUR, REPORT_RECIPIENT, SEASON_LABEL, TIER_LABEL,
  dailyReportWindow, normalizeEvents, parisMidnightUtc, parisParts, reportSendKey, type EventRow,
} from "./tire-v10";

export { REPORT_RECIPIENT, reportSendKey, parisParts, dailyReportWindow };

/** Destinataire UNIQUE du rapport (jamais les Front Office). */
export const RPT_RECIPIENT = REPORT_RECIPIENT;
/** Réessai contrôlé : uniquement de 7 h à 10 h Paris le jour J, 3 tentatives max, jamais de rattrapage d'une autre date. */
export const RPT_RETRY_LAST_HOUR = 10;
export const RPT_MAX_ATTEMPTS = 3;
export const RPT_DEFAULT_RETENTION_DAYS = 30;
export const RPT_EVENTS_MAX_BATCH = 25;
export const RPT_EVENTS_MAX_BODY = 16384;

/* ------------------------------- Réglages ------------------------------- */

export type ReportingSettings = {
  events_enabled: boolean;
  report_enabled: boolean;
  contact_log_enabled: boolean;
  /** Début d'instrumentation (null = jamais activée). */
  instrumentation_started_at: string | null;
  retention_days: number;
  /** Règle serveur explicite des tests techniques (comparaison insensible à la casse). */
  test_emails: string[];
  test_email_domains: string[];
  test_visitor_ids: string[];
};

/* ---------------------------- Tests techniques ---------------------------- */

export const TEST_MARKER = "[TEST]";
export const TEST_UTM_SOURCE = "dda_test";

/**
 * Règle EXPLICITE et unique, appliquée côté serveur à l'écriture :
 *  - contact : e-mail listé, domaine listé, ou nom/message commençant par « [TEST] » ;
 *  - événement : visitorId listé ou utm_source = « dda_test ».
 * Les tests sont exclus des chiffres métier et listés à part dans le rapport.
 */
export function isTestContact(c: { email: string; name: string; message?: string | null }, s: Pick<ReportingSettings, "test_emails" | "test_email_domains">): boolean {
  const email = c.email.trim().toLowerCase();
  const domain = email.split("@")[1] ?? "";
  if (s.test_emails.map((x) => x.trim().toLowerCase()).includes(email)) return true;
  if (s.test_email_domains.map((x) => x.trim().toLowerCase().replace(/^@/, "")).includes(domain)) return true;
  const starts = (v?: string | null) => !!v && v.trim().toUpperCase().startsWith(TEST_MARKER);
  return starts(c.name) || starts(c.message);
}

export function isTestEvent(e: Pick<EventRow, "visitor_id" | "utm_source">, s: Pick<ReportingSettings, "test_visitor_ids">): boolean {
  if (e.utm_source === TEST_UTM_SOURCE) return true;
  return !!e.visitor_id && s.test_visitor_ids.includes(e.visitor_id);
}

/* ------------------------------ Événements ------------------------------ */

const PSEUDO = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
export const rptEventItem = z
  .object({
    eventId: z.string().uuid(),
    type: z.enum(CLIENT_EVENT_TYPES),
    occurredAt: z.string().datetime().optional(),
    visitorId: PSEUDO.optional(),
    sessionId: PSEUDO.optional(),
    page: z.enum(PAGES).optional(),
    device: z.enum(DEVICES).optional(),
    utmSource: z.string().max(80).optional(),
    utmMedium: z.string().max(80).optional(),
    utmCampaign: z.string().max(80).optional(),
    width: z.number().int().min(105).max(395).optional(),
    ratio: z.number().int().min(25).max(95).optional(),
    rim: z.number().int().min(10).max(24).optional(),
    quantity: z.union([z.literal(1), z.literal(2), z.literal(4)]).optional(),
    tier: z.enum(["entree", "milieu", "haut"]).optional(),
    season: z.enum(["ete", "quatre_saisons"]).optional(),
    site: z.enum(["castillon", "lalinde"]).optional(),
    quoteId: z.string().uuid().optional(),
  })
  .strict();
export const rptEventsBatch = z
  .object({ consent: z.object({ analytics: z.boolean() }).strict(), events: z.array(rptEventItem).min(1).max(RPT_EVENTS_MAX_BATCH) })
  .strict();

export type RptEventRow = EventRow & { is_test: boolean };

/** Normalisation V10 réutilisée (pseudonymes supprimés sans consentement) + marquage test serveur. */
export function normalizeRptEvents(b: z.infer<typeof rptEventsBatch>, now: Date, s: ReportingSettings): RptEventRow[] {
  return normalizeEvents(b, now).map((r) => ({ ...r, is_test: isTestEvent(r, s) }));
}

/** Contexte analytics FACULTATIF de contact-request : uniquement si consenti, hors empreinte métier. */
export const contactAnalytics = z
  .object({ consent: z.literal(true), visitorId: PSEUDO, sessionId: PSEUDO.optional() })
  .strict();
export type ContactAnalytics = z.infer<typeof contactAnalytics>;

/** event_id déterministe d'une demande (UUID dérivé du requestId) : un rejeu ne crée pas d'événement. */
export async function requestEventId(requestId: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`tyres-contact-event:${requestId}`)));
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/* ---------------------------- Journal contact ---------------------------- */

export type ContactLogStatus = "sending" | "sent" | "failed" | "unknown";
export type ContactLogRow = {
  request_id: string; created_at: string; site_key: "castillon" | "lalinde"; status: ContactLogStatus;
  attempts: number; error_code: string | null; is_test: boolean;
  name: string; email: string; phone: string; message: string | null;
  quote_id: string; tier: string; season: string; brand: string | null; model: string | null;
  size: string | null; load_index: string | null; speed_index: string | null; quantity: number | null;
  total_ttc_cents: number | null; total_label: string | null;
  visitor_id: string | null;
};

/** Codes d'erreur GÉNÉRIQUES (jamais le texte fournisseur). */
export const CONTACT_ERROR_LABEL: Record<string, string> = {
  email_failed: "Envoi refusé ou en erreur",
  email_busy: "Fournisseur saturé",
  request_conflict: "Conflit d'identifiant",
  send_exception: "Erreur réseau",
};

/* ------------------------------ Mesure / états ------------------------------ */

export type MeasureState = "inactive" | "partial" | "active";
/**
 * « Mesure non active » : instrumentation absente ou postérieure à la journée.
 * « partial » : activée en cours de journée. Sinon « active » (0 = vraie valeur zéro).
 */
export function measureState(startedAt: string | null, eventsEnabled: boolean, dayStart: Date, dayEnd: Date): MeasureState {
  if (!startedAt || !eventsEnabled) return "inactive";
  const t = new Date(startedAt).getTime();
  if (t >= dayEnd.getTime()) return "inactive";
  return t > dayStart.getTime() ? "partial" : "active";
}

/* ------------------------------ Agrégation ------------------------------ */

export type QuoteLite = { id: string; created_at: string; request: { size?: string; quantity?: number } | null; cases: { tier: string; season: string; status: string; brand: string | null }[] | null };
export type CounterRow = { report_date: string; metric: string; value: number };

const bump = (m: Record<string, number>, k: string | null | undefined) => {
  if (k == null || k === "") return;
  m[k] = (m[k] ?? 0) + 1;
};
const sortDesc = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

export type DailyReport = ReturnType<typeof buildDailyReport>;

export function buildDailyReport(p: {
  reportDate: string; start: Date; end: Date; settings: ReportingSettings;
  events: RptEventRow[]; contacts: ContactLogRow[]; quotes: QuoteLite[]; history: CounterRow[];
}) {
  const ev = p.events.filter((e) => !e.is_test);
  const evTest = p.events.filter((e) => e.is_test);
  const contacts = p.contacts.filter((c) => !c.is_test);
  const contactsTest = p.contacts.filter((c) => c.is_test);
  const testQuoteIds = new Set<string>([...evTest, ...contactsTest].map((x) => ("quote_id" in x ? x.quote_id : null)).filter(Boolean) as string[]);
  const quotes = p.quotes.filter((q) => !testQuoteIds.has(q.id));
  const state = measureState(p.settings.instrumentation_started_at, p.settings.events_enabled, p.start, p.end);

  const consented = ev.filter((e) => e.consent);
  const pv = ev.filter((e) => e.type === "page_view");
  const sel = ev.filter((e) => e.type === "offer_selected");
  const quoteEv = ev.filter((e) => e.type === "quote_generated");

  const byHour = Array.from({ length: 24 }, () => 0);
  for (const e of pv) byHour[e.paris_hour] = (byHour[e.paris_hour] ?? 0) + 1;
  const bySource: Record<string, number> = {}, byMedium: Record<string, number> = {}, byCampaign: Record<string, number> = {};
  const byDevice: Record<string, number> = {}, byPage: Record<string, number> = {};
  for (const e of pv) {
    bump(bySource, e.utm_source ?? "direct / non renseigné");
    bump(byMedium, e.utm_medium);
    bump(byCampaign, e.utm_campaign);
    bump(byDevice, e.device ?? "inconnu");
    bump(byPage, e.page ?? "autre");
  }
  // Devis serveur (tire_web_quotes) : vérité serveur, indépendante du consentement.
  const sizes: Record<string, number> = {}, qty: Record<string, number> = {};
  let offersAvail = 0, offersUnavail = 0;
  for (const q of quotes) {
    bump(sizes, q.request?.size ?? null);
    bump(qty, q.request?.quantity != null ? String(q.request.quantity) : null);
    for (const c of q.cases ?? []) c.status === "available" ? offersAvail++ : offersUnavail++;
  }
  // Sélections (dédupliquées par devis+gamme+saison : un re-clic n'est pas une nouvelle sélection).
  const selKeys = new Set<string>();
  const brands: Record<string, number> = {}, tiers: Record<string, number> = {}, seasons: Record<string, number> = {};
  for (const e of sel) {
    const k = `${e.quote_id ?? e.event_id}|${e.tier}|${e.season}`;
    if (selKeys.has(k)) continue;
    selKeys.add(k);
    if (e.offer_verified) bump(brands, e.offer_brand);
    bump(tiers, e.tier ? TIER_LABEL[e.tier as keyof typeof TIER_LABEL] : null);
    bump(seasons, e.season ? SEASON_LABEL[e.season as keyof typeof SEASON_LABEL] : null);
  }
  // Cohorte consentie : visiteurs → devis → demande ; abandons par quoteId.
  const cv = consented.filter((e) => e.visitor_id);
  const visitors = new Set(cv.map((e) => e.visitor_id!));
  const quoteVisitors = new Set(cv.filter((e) => e.type === "quote_generated").map((e) => e.visitor_id!));
  const reqConsented = contacts.filter((c) => c.visitor_id && c.status === "sent");
  const reqVisitors = new Set(reqConsented.map((c) => c.visitor_id!));
  const selectedQuotes = new Set(cv.filter((e) => e.type === "offer_selected" && e.quote_id).map((e) => e.quote_id!));
  const requestedQuotes = new Set(contacts.filter((c) => c.status === "sent").map((c) => c.quote_id));
  const abandoned = [...selectedQuotes].filter((q) => !requestedQuotes.has(q));
  const rate = (n: number, d: number) => (d > 0 ? n / d : null);

  // Contacts par garage et statut (une demande = un requestId ; rejeux non recomptés).
  const sites = ["castillon", "lalinde"] as const;
  const contactsBySite = Object.fromEntries(
    sites.map((s) => {
      const r = contacts.filter((c) => c.site_key === s);
      return [s, { total: r.length, sent: r.filter((c) => c.status === "sent").length, failed: r.filter((c) => c.status === "failed").length, pending: r.filter((c) => c.status === "sending" || c.status === "unknown").length }];
    }),
  ) as Record<(typeof sites)[number], { total: number; sent: number; failed: number; pending: number }>;

  const counters: Record<string, number> = {
    page_views: pv.length,
    sessions_consented: new Set(consented.map((e) => e.session_id).filter(Boolean)).size,
    visitors_consented: visitors.size,
    quote_events: quoteEv.length,
    quotes_server: quotes.length,
    selections: selKeys.size,
    contacts_total: contacts.length,
    contacts_sent: contacts.filter((c) => c.status === "sent").length,
    contacts_failed: contacts.filter((c) => c.status === "failed").length,
    tests_events: evTest.length,
    tests_contacts: contactsTest.length,
  };

  // Comparatif : 7 jours précédents depuis les compteurs cumulés (sans PII), seulement si disponibles.
  const prevDays = Array.from({ length: 7 }, (_, k) => shiftDay(p.reportDate, -(k + 1)));
  const comparison = Object.fromEntries(
    ["page_views", "visitors_consented", "quotes_server", "contacts_sent"].map((m) => {
      const vals = prevDays.map((d) => p.history.find((h) => h.report_date === d && h.metric === m)?.value).filter((v): v is number => v != null);
      const yesterday = p.history.find((h) => h.report_date === prevDays[0] && h.metric === m)?.value ?? null;
      return [m, { today: counters[m]!, previousDay: yesterday, avg7: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, daysAvailable: vals.length }];
    }),
  );

  return {
    reportDate: p.reportDate, start: p.start.toISOString(), end: p.end.toISOString(),
    measure: { state, startedAt: p.settings.instrumentation_started_at, eventsReceived: ev.length, contactLogEnabled: p.settings.contact_log_enabled },
    traffic: { pageViews: pv.length, sessionsConsented: counters.sessions_consented!, visitorsConsented: visitors.size, consentedEvents: consented.length, totalEvents: ev.length, byHour, bySource: sortDesc(bySource), byMedium: sortDesc(byMedium), byCampaign: sortDesc(byCampaign), byDevice: sortDesc(byDevice), byPage: sortDesc(byPage) },
    quotes: { count: quotes.length, offersAvailable: offersAvail, offersUnavailable: offersUnavail, sizes: sortDesc(sizes), quantities: sortDesc(qty), quoteEvents: quoteEv.length },
    selections: { count: selKeys.size, brands: sortDesc(brands), tiers: sortDesc(tiers), seasons: sortDesc(seasons) },
    funnel: { visitors: visitors.size, quoteVisitors: [...quoteVisitors].filter((v) => visitors.has(v)).length, requestVisitors: reqVisitors.size, visitToQuote: rate([...quoteVisitors].filter((v) => visitors.has(v)).length, visitors.size), quoteToRequest: rate([...quoteVisitors].filter((v) => reqVisitors.has(v)).length, quoteVisitors.size), selectedQuotes: selectedQuotes.size, abandonedQuotes: abandoned.length },
    contacts: { bySite: contactsBySite, rows: [...contacts].sort((a, b) => a.created_at.localeCompare(b.created_at)) },
    tests: { events: evTest.length, contacts: [...contactsTest].sort((a, b) => a.created_at.localeCompare(b.created_at)) },
    comparison,
    counters,
  };
}

export function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/* -------------------------------- Rendu -------------------------------- */

export function escHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
/** Cellule CSV : guillemets doublés + neutralisation des formules (= + - @ tab CR). */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const eur = (c: number | null) => (c == null ? "—" : (c / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €");
const pct = (r: number | null) => (r == null ? "Non calculable" : `${(r * 100).toFixed(1).replace(".", ",")} %`);
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { timeZone: PARIS_TZ, hour: "2-digit", minute: "2-digit" });

export function contactsCsv(rows: ContactLogRow[]): string {
  const head = ["heure_paris", "garage", "statut", "erreur", "nom", "email", "telephone", "message", "gamme", "saison", "marque", "modele", "dimension", "charge_vitesse", "quantite", "total_affiche_ttc", "libelle_total", "reference_demande", "test"];
  const lines = rows.map((c) =>
    [hhmm(c.created_at), c.site_key, c.status, c.error_code ? CONTACT_ERROR_LABEL[c.error_code] ?? "Erreur" : "", c.name, c.email, c.phone, c.message ?? "", TIER_LABEL[c.tier as keyof typeof TIER_LABEL] ?? c.tier, SEASON_LABEL[c.season as keyof typeof SEASON_LABEL] ?? c.season, c.brand ?? "", c.model ?? "", c.size ?? "", `${c.load_index ?? ""}${c.speed_index ?? ""}`, c.quantity ?? "", c.total_ttc_cents != null ? (c.total_ttc_cents / 100).toFixed(2) : "", c.total_label ?? "", c.request_id, c.is_test ? "oui" : "non"].map(csvCell).join(";"),
  );
  return "\uFEFF" + [head.map(csvCell).join(";"), ...lines].join("\r\n");
}

export function renderReportHtml(r: DailyReport): string {
  const st = r.measure.state;
  const val = (n: number) => (st === "inactive" ? "Mesure non active" : r.measure.eventsReceived === 0 ? "Aucune donnée reçue" : String(n));
  const list = (rows: [string, number][], empty = "Aucune donnée") => (rows.length ? `<ul>${rows.slice(0, 15).map(([k, v]) => `<li>${escHtml(k)} : <b>${v}</b></li>`).join("")}</ul>` : `<p style="color:#666">${empty}</p>`);
  const cmpRow = (label: string, m: string) => {
    const c = r.comparison[m]!;
    return `<tr><td>${escHtml(label)}</td><td><b>${c.today}</b></td><td>${c.previousDay ?? "Non disponible"}</td><td>${c.avg7 == null ? "Non disponible" : `${c.avg7.toFixed(1).replace(".", ",")} (${c.daysAvailable} j)`}</td></tr>`;
  };
  const contactRow = (c: ContactLogRow) =>
    `<tr><td>${hhmm(c.created_at)}</td><td>${escHtml(c.site_key)}</td><td>${escHtml(c.status === "sent" ? "Mail accepté" : c.status === "failed" ? "Échec" : "En cours / inconnu")}${c.error_code ? ` — ${escHtml(CONTACT_ERROR_LABEL[c.error_code] ?? "Erreur")}` : ""}</td><td>${escHtml(c.name)}<br/>${escHtml(c.email)}<br/>${escHtml(c.phone)}</td><td>${escHtml([c.brand, c.model].filter(Boolean).join(" "))}<br/>${escHtml(c.size ?? "")} ${escHtml(`${c.load_index ?? ""}${c.speed_index ?? ""}`)} · ${escHtml(TIER_LABEL[c.tier as keyof typeof TIER_LABEL] ?? c.tier)} · ${escHtml(SEASON_LABEL[c.season as keyof typeof SEASON_LABEL] ?? c.season)} · x${c.quantity ?? "?"}<br/>${escHtml(c.total_label ?? "Total TTC")} : <b>${eur(c.total_ttc_cents)}</b></td><td>${c.message ? escHtml(c.message).replace(/\n/g, "<br/>") : ""}</td></tr>`;
  const sites = r.contacts.bySite;
  const hours = r.traffic.byHour.map((n, h) => `<td style="text-align:center;padding:2px 4px;">${h}h<br/><b>${n}</b></td>`).join("");
  const stateTxt = st === "inactive" ? "Mesure d'audience non active sur cette journée." : st === "partial" ? `Mesure activée en cours de journée (${escHtml(r.measure.startedAt ? new Date(r.measure.startedAt).toLocaleString("fr-FR", { timeZone: PARIS_TZ }) : "")}) : chiffres partiels.` : `Mesure active depuis le ${escHtml(r.measure.startedAt ? new Date(r.measure.startedAt).toLocaleDateString("fr-FR", { timeZone: PARIS_TZ }) : "")}.`;
  return `<!DOCTYPE html><html lang="fr"><body style="font-family:Arial,sans-serif;color:#1a1a1a;background:#fff;font-size:14px;">
<h2>DDA Pneus — rapport du ${escHtml(r.reportDate)} (journée Paris)</h2>
<p style="color:#555">${stateTxt} Tests techniques exclus des chiffres (listés en fin de rapport). Visiteurs et sessions : uniquement parmi les personnes ayant accepté la mesure d'audience.</p>
<h3>Audience</h3>
<table><tr><td>Pages vues</td><td><b>${val(r.traffic.pageViews)}</b></td></tr><tr><td>Visiteurs consentis</td><td><b>${val(r.traffic.visitorsConsented)}</b></td></tr><tr><td>Sessions consenties</td><td><b>${val(r.traffic.sessionsConsented)}</b></td></tr><tr><td>Événements consentis / reçus</td><td>${val(r.traffic.consentedEvents)} / ${val(r.traffic.totalEvents)}</td></tr></table>
<h4>Pages</h4>${list(r.traffic.byPage)}<h4>Sources (UTM)</h4>${list(r.traffic.bySource)}${r.traffic.byMedium.length ? `<h4>Supports</h4>${list(r.traffic.byMedium)}` : ""}${r.traffic.byCampaign.length ? `<h4>Campagnes</h4>${list(r.traffic.byCampaign)}` : ""}<h4>Appareils</h4>${list(r.traffic.byDevice)}
<h4>Pages vues par heure (Paris)</h4><table style="border-collapse:collapse;font-size:11px;"><tr>${hours}</tr></table>
<h3>Devis (6 offres Top prix)</h3>
<table><tr><td>Devis générés (serveur)</td><td><b>${r.quotes.count}</b></td></tr><tr><td>Offres disponibles / indisponibles</td><td>${r.quotes.offersAvailable} / ${r.quotes.offersUnavailable}</td></tr></table>
<h4>Dimensions</h4>${list(r.quotes.sizes)}<h4>Quantités</h4>${list(r.quotes.quantities)}
<h3>Sélections d'offres</h3><p>Sélections distinctes : <b>${val(r.selections.count)}</b></p><h4>Marques (offre serveur)</h4>${list(r.selections.brands)}<h4>Gammes</h4>${list(r.selections.tiers)}<h4>Saisons</h4>${list(r.selections.seasons)}
<h3>Conversion (cohorte consentie)</h3>
<table><tr><td>Visiteurs</td><td>${r.funnel.visitors}</td></tr><tr><td>→ ayant généré un devis</td><td>${r.funnel.quoteVisitors} (${pct(r.funnel.visitToQuote)})</td></tr><tr><td>→ ayant envoyé une demande</td><td>${r.funnel.requestVisitors} (${pct(r.funnel.quoteToRequest)} des devis)</td></tr><tr><td>Devis avec offre choisie / sans demande (abandons)</td><td>${r.funnel.selectedQuotes} / ${r.funnel.abandonedQuotes}</td></tr></table>
<h3>Comparatif</h3><table border="1" cellpadding="4" style="border-collapse:collapse;"><tr><th></th><th>Ce jour</th><th>Veille</th><th>Moyenne 7 j précédents</th></tr>${cmpRow("Pages vues", "page_views")}${cmpRow("Visiteurs consentis", "visitors_consented")}${cmpRow("Devis", "quotes_server")}${cmpRow("Demandes envoyées", "contacts_sent")}</table>
<h3>Demandes de contact</h3>
${r.measure.contactLogEnabled ? "" : `<p style="color:#a00">Journal des demandes non actif : détail indisponible.</p>`}
<table><tr><td>Castillon</td><td>${sites.castillon.total} demande(s) — ${sites.castillon.sent} mail(s) accepté(s), ${sites.castillon.failed} échec(s), ${sites.castillon.pending} en cours</td></tr><tr><td>Lalinde</td><td>${sites.lalinde.total} demande(s) — ${sites.lalinde.sent} mail(s) accepté(s), ${sites.lalinde.failed} échec(s), ${sites.lalinde.pending} en cours</td></tr></table>
${r.contacts.rows.length ? `<table border="1" cellpadding="4" style="border-collapse:collapse;font-size:12px;"><tr><th>Heure</th><th>Garage</th><th>Statut</th><th>Client</th><th>Offre affichée</th><th>Message</th></tr>${r.contacts.rows.map(contactRow).join("")}</table>` : `<p>Aucune demande.</p>`}
<h3>Tests techniques (exclus)</h3><p>Événements de test : ${r.tests.events} · Demandes de test : ${r.tests.contacts.length}</p>
${r.tests.contacts.length ? `<table border="1" cellpadding="4" style="border-collapse:collapse;font-size:12px;"><tr><th>Heure</th><th>Garage</th><th>Statut</th><th>Client</th><th>Offre affichée</th><th>Message</th></tr>${r.tests.contacts.map(contactRow).join("")}</table>` : ""}
<p style="color:#777;font-size:11px;">Détails des demandes et événements conservés ${"30"} jours (journal technique), puis purgés ; seuls des compteurs anonymes sont gardés. Aucun prix d'achat, marge, IP ni secret dans ce rapport.</p>
</body></html>`;
}

/* ------------------------------- Planificateur ------------------------------- */

/**
 * Appel nominal horaire `0 * * * *` UTC. N'agit qu'à 7 h Paris (DST géré),
 * réessai contrôlé jusqu'à 10 h pour la SEULE veille ; aucune autre date.
 */
export function schedulerDecision(now: Date): { act: boolean; firstSlot: boolean; reportDate: string; start: Date; end: Date } {
  const pp = parisParts(now);
  const reportDate = shiftDay(pp.day, -1);
  return {
    act: pp.hour >= REPORT_LOCAL_HOUR && pp.hour <= RPT_RETRY_LAST_HOUR,
    firstSlot: pp.hour === REPORT_LOCAL_HOUR,
    reportDate,
    start: parisMidnightUtc(reportDate),
    end: parisMidnightUtc(pp.day),
  };
}
