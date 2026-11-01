import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  RPT_RECIPIENT, buildDailyReport, contactsCsv, csvCell, escHtml, isTestContact, isTestEvent, measureState,
  renderReportHtml, requestEventId, schedulerDecision, type ContactLogRow, type ReportingSettings, type RptEventRow,
} from "@/lib/tyre-reporting";
import { enrichRptRows, handleDailyReportCron, handleRptEvents, type ContactLogDeps, type ReportDeps, type ReportSnapshot, type RptEventsDeps } from "@/lib/tyre-reporting.server";
import { quoteDimension } from "@/lib/tyre-reporting";
import { handleContactPost, type ContactDeps } from "@/lib/tire-web-contact.server";
import type { WebQuoteCase, WebQuoteConfig } from "@/lib/tire-web-api";

const A = "https://pneu.garagecastillon.fr";
const cfg: WebQuoteConfig = { web_supplier: "top_prix", site_id: "s1", enabled: true, allowed_origins: [A], quota_ip_per_10min: 10, quota_global_per_hour: 100 };
const settings: ReportingSettings = {
  events_enabled: true, report_enabled: true, contact_log_enabled: true, instrumentation_started_at: "2026-10-01T00:00:00Z",
  retention_days: 30, test_emails: ["damien@garagecastillon.fr"], test_email_domains: ["dda-test.fr"], test_visitor_ids: ["testvisitor_0000000001"],
};
const offer: WebQuoteCase = {
  tier: "milieu", season: "ete", status: "available", brand: "Hankook", model: "Ventus", size: "205/55R16", loadIndex: "91", speedIndex: "V",
  quantity: 4, totalTtcCents: 41234, includedServices: [{ code: "montage", label: "Montage" }], compatibility: null, compatibilityMessage: null,
};

function ev(over: Partial<RptEventRow>): RptEventRow {
  return {
    event_id: crypto.randomUUID(), type: "page_view", occurred_at: "2026-10-31T09:00:00Z", consent: true, visitor_id: "visitor_aaaaaaaaaaaa1",
    session_id: "session_aaaaaaaaaaaa1", page: "accueil", device: "mobile", utm_source: null, utm_medium: null, utm_campaign: null,
    size: null, quantity: null, tier: null, season: null, site_key: null, paris_day: "2026-10-31", paris_hour: 10, paris_weekday: 6,
    quote_id: null, offer_brand: null, offer_verified: false, is_test: false, ...over,
  };
}
function contact(over: Partial<ContactLogRow>): ContactLogRow {
  return {
    request_id: crypto.randomUUID(), created_at: "2026-10-31T10:00:00Z", site_key: "castillon", status: "sent", attempts: 1, error_code: null,
    is_test: false, name: "Jean", email: "jean@client.fr", phone: "0600000000", message: null, quote_id: "q1", tier: "milieu", season: "ete",
    brand: "Hankook", model: "Ventus", size: "205/55R16", load_index: "91", speed_index: "V", quantity: 4, total_ttc_cents: 41234,
    total_label: "Total TTC monté", visitor_id: null, ...over,
  };
}

describe("règles pures", () => {
  it("règle de test explicite", () => {
    expect(isTestContact({ email: "Damien@GarageCastillon.fr", name: "x" }, settings)).toBe(true);
    expect(isTestContact({ email: "a@dda-test.fr", name: "x" }, settings)).toBe(true);
    expect(isTestContact({ email: "a@b.fr", name: "[test] essai" }, settings)).toBe(true);
    expect(isTestContact({ email: "a@b.fr", name: "Jean" }, settings)).toBe(false);
    expect(isTestEvent({ visitor_id: null, utm_source: "dda_test" }, settings)).toBe(true);
    expect(isTestEvent({ visitor_id: "testvisitor_0000000001", utm_source: null }, settings)).toBe(true);
  });
  it("CSV neutralise les formules et HTML échappé", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell('a"b')).toBe(`"a""b"`);
    expect(escHtml("<script>")).toBe("&lt;script&gt;");
    const csv = contactsCsv([contact({ name: "+cmd", message: "@x" })]);
    expect(csv).toContain(`"'+cmd"`);
    expect(csv).toContain(`"'@x"`);
  });
  it("états de mesure", () => {
    const s = new Date("2026-10-31T00:00:00Z"), e = new Date("2026-11-01T00:00:00Z");
    expect(measureState(null, true, s, e)).toBe("inactive");
    expect(measureState("2026-11-01T05:00:00Z", true, s, e)).toBe("inactive");
    expect(measureState("2026-10-31T12:00:00Z", true, s, e)).toBe("partial");
    expect(measureState("2026-10-01T00:00:00Z", false, s, e)).toBe("inactive");
  });
  it("planificateur : 7 h Paris en hiver et en été, veille Paris (DST 25 h)", () => {
    const w = schedulerDecision(new Date("2026-11-01T06:00:00Z"));
    expect(w).toMatchObject({ act: true, firstSlot: true, reportDate: "2026-10-31" });
    expect(w.end.getTime() - w.start.getTime()).toBe(24 * 3600_000);
  });
  it("planificateur : fenêtres", () => {
    expect(schedulerDecision(new Date("2026-07-01T05:00:00Z"))).toMatchObject({ act: true, firstSlot: true, reportDate: "2026-06-30" });
    expect(schedulerDecision(new Date("2026-07-01T04:00:00Z")).act).toBe(false);
    expect(schedulerDecision(new Date("2026-07-01T09:00:00Z")).act).toBe(false); // 11 h Paris
    const d = schedulerDecision(new Date("2026-10-26T06:00:00Z")); // veille = 25/10, 25 h
    expect(d.end.getTime() - d.start.getTime()).toBe(25 * 3600_000);
    const m = schedulerDecision(new Date("2026-03-30T05:00:00Z")); // veille = 29/03, 23 h
    expect(m.end.getTime() - m.start.getTime()).toBe(23 * 3600_000);
  });
  it("event_id déterministe par requestId", async () => {
    const id = "11111111-2222-4333-8444-555555555555";
    expect(await requestEventId(id)).toBe(await requestEventId(id));
    expect(await requestEventId(id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab]/);
  });
});

describe("agrégation du rapport", () => {
  const base = { reportDate: "2026-10-31", start: new Date("2026-10-30T23:00:00Z"), end: new Date("2026-10-31T23:00:00Z"), settings };
  it("exclut les tests, déduplique, distingue indisponible", () => {
    const r = buildDailyReport({
      ...base,
      events: [
        ev({}), ev({ visitor_id: "visitor_bbbbbbbbbbbb2", paris_hour: 18 }), ev({ is_test: true }),
        ev({ type: "quote_generated", quote_id: "q1" }),
        ev({ type: "offer_selected", quote_id: "q1", tier: "milieu", season: "ete", offer_brand: "Hankook", offer_verified: true }),
        ev({ type: "offer_selected", quote_id: "q1", tier: "milieu", season: "ete", offer_brand: "Hankook", offer_verified: true }),
        ev({ type: "offer_selected", quote_id: "q2", tier: "haut", season: "ete", visitor_id: "visitor_bbbbbbbbbbbb2", offer_brand: "Michelin", offer_verified: true }),
      ],
      contacts: [contact({ visitor_id: "visitor_aaaaaaaaaaaa1" }), contact({ status: "failed", error_code: "email_failed", site_key: "lalinde", quote_id: "q9" }), contact({ is_test: true, email: "damien@garagecastillon.fr", quote_id: "qt" })],
      quotes: [{ id: "q1", created_at: "", request: { size: "205/55R16", quantity: 4 }, cases: [{ tier: "milieu", season: "ete", status: "available", brand: "Hankook" }, { tier: "haut", season: "ete", status: "unavailable", brand: null }] }],
      history: [{ report_date: "2026-10-30", metric: "page_views", value: 5 }],
    });
    expect(r.traffic.pageViews).toBe(2);
    expect(r.traffic.byHour[18]).toBe(1);
    expect(r.selections.count).toBe(2);
    expect(r.selections.brands).toEqual([["Hankook", 1], ["Michelin", 1]]);
    expect(r.funnel.abandonedQuotes).toBe(1); // visiteur b / q2 sans demande
    expect(r.contacts.bySite.castillon).toEqual({ total: 1, sent: 1, failed: 0, pending: 0 });
    expect(r.contacts.bySite.lalinde.failed).toBe(1);
    expect(r.tests.contacts).toHaveLength(1);
    expect(r.tests.events).toBe(1);
    expect(r.quotes).toMatchObject({ count: 1, offersAvailable: 1, offersUnavailable: 1, testOnly: 1, sharedWithTests: 0 });
    expect(r.quotes.sizes).toEqual([["205/55R16", 1]]);
    expect(r.comparison["page_views"]).toMatchObject({ today: 2, previousDay: 5, daysAvailable: 1 });
    expect(r.comparison["contacts_sent"]!.previousDay).toBeNull();
    const html = renderReportHtml(r);
    expect(html).toContain("Non disponible");
    expect(html).toContain("Tests techniques (exclus)");
    expect(html).not.toMatch(/purchase|margin|cost_|ip_hash/i);
    expect(html).toContain("conservés 30 jours");
  });
  it("devis partagé entre 2 visiteurs : l'un envoie, l'autre abandonne ; un test sur le même devis ne l'exclut pas", () => {
    const sel = (v: string) => ev({ type: "offer_selected", visitor_id: v, quote_id: "qs", tier: "milieu", season: "ete" });
    const r = buildDailyReport({
      ...base,
      events: [sel("visitor_aaaaaaaaaaaa1"), sel("visitor_aaaaaaaaaaaa1"), sel("visitor_bbbbbbbbbbbb2"), ev({ type: "offer_selected", quote_id: "qs", is_test: true, tier: "milieu", season: "ete" })],
      contacts: [contact({ quote_id: "qs", visitor_id: "visitor_aaaaaaaaaaaa1" })],
      quotes: [{ id: "qs", created_at: "", request: { size: "205/55R16", loadIndex: 91, speedIndex: "V", quantity: 4 }, cases: [] }],
      history: [],
    });
    expect(r.selections.count).toBe(2);
    expect(r.funnel.selectedQuotes).toBe(2);
    expect(r.funnel.abandonedQuotes).toBe(1);
    expect(r.quotes).toMatchObject({ count: 1, testOnly: 0, sharedWithTests: 1 });
    expect(r.quotes.sizes).toEqual([["205/55R16 91V", 1]]);
  });
  it("dimension : size réel prioritaire, sinon width/ratio/rim, sinon null", () => {
    expect(quoteDimension({ size: "205/55R16", loadIndex: 91, speedIndex: "V" })).toBe("205/55R16 91V");
    expect(quoteDimension({ width: 225, ratio: 45, rim: 17 })).toBe("225/45R17");
    expect(quoteDimension({ size: "<b>" })).toBeNull();
  });
  it("mesure inactive : pas de compteur d'audience enregistré (pas de faux 0)", () => {
    const r = buildDailyReport({ ...base, settings: { ...settings, instrumentation_started_at: null }, events: [], contacts: [], quotes: [], history: [] });
    expect(r.counters).not.toHaveProperty("page_views");
    expect(r.counters).toHaveProperty("contacts_sent", 0);
    expect(r.comparison["page_views"]!.inactive).toBe(true);
  });
  it("mesure non active vs aucune donnée", () => {
    const off = renderReportHtml(buildDailyReport({ ...base, settings: { ...settings, instrumentation_started_at: null }, events: [], contacts: [], quotes: [], history: [] }));
    expect(off).toContain("Mesure non active");
    const none = renderReportHtml(buildDailyReport({ ...base, events: [], contacts: [], quotes: [], history: [] }));
    expect(none).toContain("Aucune donnée reçue");
  });
  it("noms hostiles échappés dans le HTML", () => {
    const html = renderReportHtml(buildDailyReport({ ...base, events: [], contacts: [contact({ name: "<img src=x onerror=1>" })], quotes: [], history: [] }));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});

describe("POST /events (indépendant de V10)", () => {
  const req = (body: unknown, origin = A) => new Request("http://x/api/public/tyres/events", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  const batch = { consent: { analytics: false }, events: [{ eventId: crypto.randomUUID(), type: "page_view", visitorId: "visitor_aaaaaaaaaaaa1", page: "accueil" }] };
  const deps = (over: Partial<RptEventsDeps> = {}): RptEventsDeps & { rows: RptEventRow[] } => {
    const rows: RptEventRow[] = [];
    return { rows, loadConfig: async () => cfg, loadSettings: async () => settings, quotaHit: async () => true, insertEvents: async (r) => (rows.push(...r), r.length), now: () => new Date("2026-11-01T10:00:00Z"), ...over };
  };
  it("désactivé => 503 ; origine inconnue => 403", async () => {
    expect((await handleRptEvents(req(batch), deps({ loadSettings: async () => ({ ...settings, events_enabled: false }) }))).status).toBe(503);
    expect((await handleRptEvents(req(batch, "https://evil.test"), deps())).status).toBe(403);
  });
  it("sans consentement : rien n'est enregistré", async () => {
    const d = deps();
    const r = await handleRptEvents(req(batch), d);
    expect(r.status).toBe(202);
    expect(r.headers.get("access-control-allow-origin")).toBe(A);
    expect(await r.json()).toMatchObject({ accepted: 0, ignored: 1 });
    expect(d.rows).toHaveLength(0);
  });
  it("marque relue dans le devis serveur (quoteId + gamme + saison), jamais du client", async () => {
    const qid = "6f1c2a4e-1b2c-4d5e-8f90-123456789abc";
    const d = deps({ loadQuotes: async (ids) => ids.map((id) => ({ id, created_at: "", request: { size: "205/55R16", quantity: 4 }, cases: [{ tier: "haut", season: "ete", status: "available", brand: "Michelin" }] })) });
    const b = { consent: { analytics: true }, events: [{ eventId: crypto.randomUUID(), type: "offer_selected", visitorId: "visitor_aaaaaaaaaaaa1", quoteId: qid, tier: "haut", season: "ete" }] };
    await handleRptEvents(req(b), d);
    expect(d.rows[0]).toMatchObject({ offer_brand: "Michelin", offer_verified: true, size: "205/55R16", quantity: 4 });
  });
  it("devis illisible : marque non vérifiée", async () => {
    const rows = await enrichRptRows([ev({ type: "offer_selected", quote_id: "q", tier: "haut", season: "ete", offer_brand: "Fake" })], async () => { throw new Error("db"); });
    expect(rows[0]).toMatchObject({ offer_brand: null, offer_verified: false });
  });
  it("champ non listé refusé", async () => {
    const bad = { ...batch, events: [{ ...batch.events[0], email: "a@b.fr" }] };
    expect((await handleRptEvents(req(bad), deps())).status).toBe(400);
  });
});

describe("contact-request + journal technique", () => {
  const good = {
    requestId: "11111111-2222-4333-8444-555555555555", quoteId: "6f1c2a4e-1b2c-4d5e-8f90-123456789abc", tier: "milieu", season: "ete",
    site: "castillon", name: "Jean Client", email: "jean@client.fr", phone: "06 00 00 00 00", consent: true,
  };
  const req = (b: unknown) => new Request("http://x/c", { method: "POST", headers: { origin: A, "content-type": "application/json" }, body: JSON.stringify(b) });
  function mk(log: Partial<ContactLogDeps> | null, over: Partial<ContactDeps> = {}) {
    const mails: Parameters<ContactDeps["sendEmail"]>[0][] = [];
    const logged: { begin: unknown[]; finish: unknown[]; events: RptEventRow[] } = { begin: [], finish: [], events: [] };
    const d: ContactDeps = {
      loadConfig: async () => cfg, quotaHit: async () => true,
      loadQuote: async () => ({ created_at: "2026-11-01T11:58:00Z", expires_at: "2026-11-01T12:10:00Z", cases: [offer] }),
      sendEmail: async (m) => (mails.push(m), { ok: true, id: "re_1", status: 200 }), now: () => new Date("2026-11-01T12:00:00Z"),
      log: log === null ? null : {
        loadSettings: async () => settings, begin: async (r) => (logged.begin.push(r), true),
        finish: async (...a) => void logged.finish.push(a), insertEvents: async (r) => (logged.events.push(...r), r.length), ...log,
      },
      ...over,
    };
    return { d, mails, logged };
  }
  it("journal en panne : l'e-mail part et la réponse reste sent", async () => {
    const { d, mails } = mk({ begin: async () => { throw new Error("db"); }, finish: async () => { throw new Error("db"); } });
    const r = await handleContactPost(req(good), d);
    expect(r.status).toBe(200);
    expect(mails).toHaveLength(1);
  });
  it("analytics consenti : hors e-mail et clé, événement sans PII", async () => {
    const a = mk({});
    const b = mk({});
    await handleContactPost(req(good), a.d);
    await handleContactPost(req({ ...good, analytics: { consent: true, visitorId: "visitor_aaaaaaaaaaaa1" } }), b.d);
    expect(b.mails[0]!.html).toBe(a.mails[0]!.html);
    expect(b.mails[0]!.idempotencyKey).toBe(a.mails[0]!.idempotencyKey);
    expect(a.logged.events).toHaveLength(0);
    expect(b.logged.events).toHaveLength(1);
    const s = JSON.stringify(b.logged.events[0]);
    expect(s).not.toMatch(/Jean|client\.fr|06 00/);
    expect(b.logged.events[0]!.event_id).toBe(await requestEventId(good.requestId));
  });
  it("échec fournisseur : journal failed, pas de faux succès ; logs sans PII", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { d, logged } = mk({}, { sendEmail: async () => ({ ok: false, status: 500, error: "boom jean@client.fr" }) });
    const r = await handleContactPost(req(good), d);
    expect(r.status).toBe(502);
    expect(logged.finish[0]).toEqual([good.requestId, "failed", "email_failed"]);
    const out = [...spy.mock.calls, ...info.mock.calls].flat().join(" ");
    expect(out).not.toMatch(/jean|0600|06 00/i);
    spy.mockRestore();
    info.mockRestore();
  });
  it("journal désactivé : rien écrit", async () => {
    const { d, logged } = mk({ loadSettings: async () => ({ ...settings, contact_log_enabled: false }) });
    expect((await handleContactPost(req(good), d)).status).toBe(200);
    expect(logged.begin).toHaveLength(0);
  });
  it("contexte analytics non consenti refusé", async () => {
    const { d } = mk({});
    expect((await handleContactPost(req({ ...good, analytics: { consent: false, visitorId: "visitor_aaaaaaaaaaaa1" } }), d)).status).toBe(400);
  });
});

describe("contact-request : recorded (preuve journal)", () => {
  const good = {
    requestId: "11111111-2222-4333-8444-555555555555", quoteId: "6f1c2a4e-1b2c-4d5e-8f90-123456789abc", tier: "milieu", season: "ete",
    site: "castillon", name: "Jean Client", email: "jean@client.fr", phone: "06 00 00 00 00", consent: true,
  };
  const req = (b: unknown) => new Request("http://x/c", { method: "POST", headers: { origin: A, "content-type": "application/json" }, body: JSON.stringify(b) });
  /** Fausse base : begin = INSERT ON CONFLICT (contenu initial conservé, attempts+1), finish ne rétrograde pas « sent ». */
  function fakeDb(over: Partial<ContactLogDeps> = {}) {
    const rows = new Map<string, ContactLogRow>();
    const log: ContactLogDeps = {
      loadSettings: async () => settings,
      begin: async (r) => { const e = rows.get(r.request_id); if (e) { e.attempts++; return false; } rows.set(r.request_id, { ...r }); return true; },
      finish: async (id, st, code) => { const e = rows.get(id); if (e && e.status !== "sent") { e.status = st; e.error_code = code; } },
      insertEvents: async (r) => r.length,
      readBack: async (id) => (rows.has(id) ? { ...rows.get(id)! } : null),
      ...over,
    };
    const d: ContactDeps = {
      loadConfig: async () => cfg, quotaHit: async () => true,
      loadQuote: async () => ({ created_at: "2026-11-01T11:58:00Z", expires_at: "2026-11-01T12:10:00Z", cases: [offer] }),
      sendEmail: async () => ({ ok: true, id: "re_1", status: 200 }), now: () => new Date("2026-11-01T12:00:00Z"), log,
    };
    return { d, rows };
  }
  const body = async (r: Response) => (await r.json()) as { recorded?: boolean } & Record<string, unknown>;
  it("ligne relue sent + contenu identique : recorded true, contrat existant conservé", async () => {
    const { d, rows } = fakeDb();
    expect(await body(await handleContactPost(req(good), d))).toEqual({ requestId: good.requestId, status: "sent", garage: "castillon", recorded: true });
    expect(rows.get(good.requestId)!.status).toBe("sent");
  });
  it("journal en échec (begin/finish) : succès mail mais recorded false", async () => {
    const { d } = fakeDb({ begin: async () => { throw new Error("db"); } });
    const r = await handleContactPost(req(good), d);
    expect(r.status).toBe(200);
    expect((await body(r)).recorded).toBe(false);
    const f = fakeDb({ finish: async () => { throw new Error("db"); } });
    expect((await body(await handleContactPost(req(good), f.d))).recorded).toBe(false);
  });
  it("journal absent, désactivé ou sans relecture : recorded false", async () => {
    const a = fakeDb(); a.d.log = null;
    expect((await body(await handleContactPost(req(good), a.d))).recorded).toBe(false);
    const b = fakeDb({ loadSettings: async () => ({ ...settings, contact_log_enabled: false }) });
    expect((await body(await handleContactPost(req(good), b.d))).recorded).toBe(false);
    const c = fakeDb({ readBack: undefined });
    expect((await body(await handleContactPost(req(good), c.d))).recorded).toBe(false);
    const e = fakeDb({ readBack: async () => { throw new Error("read"); } });
    expect((await body(await handleContactPost(req(good), e.d))).recorded).toBe(false);
  });
  it("rejeu même demande : recorded true, ligne unique", async () => {
    const { d, rows } = fakeDb();
    await handleContactPost(req(good), d);
    expect((await body(await handleContactPost(req(good), d))).recorded).toBe(true);
    expect(rows.size).toBe(1);
    expect(rows.get(good.requestId)!.attempts).toBe(2);
  });
  it("même requestId, contenu différent déjà journalisé : recorded false", async () => {
    const { d } = fakeDb();
    await handleContactPost(req(good), d);
    expect((await body(await handleContactPost(req({ ...good, phone: "07 11 11 11 11" }), d))).recorded).toBe(false);
  });
  it("ligne relue non sent : recorded false", async () => {
    const { d } = fakeDb({ finish: async () => undefined });
    expect((await body(await handleContactPost(req(good), d))).recorded).toBe(false);
  });
  it("relecture trop lente (timeout 1,5 s) : recorded false", async () => {
    vi.useFakeTimers();
    try {
      const { d } = fakeDb({ readBack: () => new Promise(() => undefined) });
      const p = handleContactPost(req(good), d);
      await vi.advanceTimersByTimeAsync(2000);
      const r = await p;
      expect(r.status).toBe(200);
      expect((await body(r)).recorded).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it("échec e-mail : jamais recorded", async () => {
    const { d } = fakeDb();
    d.sendEmail = async () => ({ ok: false, status: 500 });
    const r = await handleContactPost(req(good), d);
    expect(r.status).toBe(502);
    expect((await body(r)).recorded).toBeUndefined();
  });
});

describe("rapport planifié", () => {
  const AT7 = new Date("2026-11-01T06:00:00Z");
  const req = (token = "t".repeat(64)) => new Request("http://x/r", { method: "POST", headers: { authorization: `Bearer ${token}` } });
  function mk(over: Partial<ReportDeps> = {}) {
    const mails: Parameters<ReportDeps["sendEmail"]>[0][] = [];
    const finished: unknown[] = [];
    const counters: unknown[] = [];
    const store = new Map<string, ReportSnapshot>();
    const d: ReportDeps = {
      verifyToken: async (t) => t === "t".repeat(64), loadSettings: async () => settings,
      claim: async () => ({ claimed: true, attempt: 1, previous: "none", prevKey: null }),
      loadSnapshot: async () => store.get("2026-10-31") ?? null,
      saveSnapshot: async (date, _k, snap) => void store.set(date, snap),
      finish: async (...a) => void finished.push(a),
      loadEvents: async () => ({ rows: [ev({})], truncated: false }), loadContacts: async () => ({ rows: [contact({})], truncated: false }),
      loadQuotes: async () => ({ rows: [], truncated: false }), loadHistory: async () => [], saveCounters: async (...a) => void counters.push(a),
      sendEmail: async (m) => (mails.push(m), { ok: true, id: "re_r", status: 200 }), now: () => AT7, ...over,
    };
    return { d, mails, finished, counters, store };
  }
  it("bearer refusé", async () => {
    expect((await handleDailyReportCron(req("x".repeat(64)), mk().d)).status).toBe(401);
    expect((await handleDailyReportCron(new Request("http://x/r", { method: "POST" }), mk().d)).status).toBe(401);
  });
  it("hors fenêtre / désactivé : rien envoyé", async () => {
    const a = mk({ now: () => new Date("2026-11-01T12:00:00Z") });
    expect(await (await handleDailyReportCron(req(), a.d)).json()).toMatchObject({ reason: "outside_window" });
    const b = mk({ loadSettings: async () => ({ ...settings, report_enabled: false }) });
    expect(await (await handleDailyReportCron(req(), b.d)).json()).toMatchObject({ reason: "report_disabled" });
    expect([...a.mails, ...b.mails]).toHaveLength(0);
  });
  it("envoi unique au seul destinataire, CSV joint, compteurs", async () => {
    const m = mk();
    const r = await handleDailyReportCron(req(), m.d);
    expect(r.status).toBe(200);
    expect(m.mails).toHaveLength(1);
    expect(m.mails[0]!.to).toBe(RPT_RECIPIENT);
    expect(RPT_RECIPIENT).toBe("damien@garagecastillon.fr");
    expect(m.mails[0]!.idempotencyKey).toBe("tyres-rpt-2026-10-31");
    expect(m.mails[0]!.attachments[0]!.filename).toBe("dda-pneus-demandes-2026-10-31.csv");
    expect(m.counters).toHaveLength(1);
    const body = await r.text();
    expect(body).not.toMatch(/jean/i);
  });
  it("déjà envoyé : aucun doublon", async () => {
    const m = mk({ claim: async () => ({ claimed: false, reason: "already_sent" }) });
    await handleDailyReportCron(req(), m.d);
    expect(m.mails).toHaveLength(0);
  });
  it("retry après échec confirmé = nouvelle clé ; issue inconnue = même clé", async () => {
    const f = mk({ claim: async () => ({ claimed: true, attempt: 2, previous: "failed", prevKey: "tyres-rpt-2026-10-31" }) });
    await handleDailyReportCron(req(), f.d);
    expect(f.mails[0]!.idempotencyKey).toBe("tyres-rpt-2026-10-31-r2");
    const s = mk({ claim: async () => ({ claimed: true, attempt: 2, previous: "stale", prevKey: "tyres-rpt-2026-10-31" }) });
    s.store.set("2026-10-31", { subject: "S", html: "<p>figé</p>", csv: null, counters: {} });
    await handleDailyReportCron(req(), s.d);
    expect(s.mails[0]!.html).toBe("<p>figé</p>");
    expect(s.mails[0]!.idempotencyKey).toBe("tyres-rpt-2026-10-31");
  });
  it("reprise même clé = snapshot identique, sans relire les contacts modifiés", async () => {
    const m = mk({ sendEmail: async () => { throw new Error("net"); } });
    await handleDailyReportCron(req(), m.d);
    const first = m.store.get("2026-10-31")!;
    const loadContacts = vi.fn(async () => ({ rows: [contact({ name: "Modifié" })], truncated: false }));
    const mails: Parameters<ReportDeps["sendEmail"]>[0][] = [];
    m.d.claim = async () => ({ claimed: true, attempt: 2, previous: "stale", prevKey: "tyres-rpt-2026-10-31" });
    m.d.loadContacts = loadContacts;
    m.d.sendEmail = async (x) => (mails.push(x), { ok: true, id: "re", status: 200 });
    await handleDailyReportCron(req(), m.d);
    expect(loadContacts).not.toHaveBeenCalled();
    expect(mails[0]!.html).toBe(first.html);
    expect(mails[0]!.idempotencyKey).toBe("tyres-rpt-2026-10-31");
  });
  it("reprise stale sans snapshot : échec avant envoi", async () => {
    const m = mk({ claim: async () => ({ claimed: true, attempt: 2, previous: "stale", prevKey: "k" }) });
    expect((await handleDailyReportCron(req(), m.d)).status).toBe(503);
    expect(m.mails).toHaveLength(0);
    expect(m.finished[0]).toEqual(["2026-10-31", "failed", "snapshot_missing", null]);
  });
  it("snapshot non persisté : rien envoyé", async () => {
    const m = mk({ saveSnapshot: async () => { throw new Error("db"); } });
    await handleDailyReportCron(req(), m.d);
    expect(m.mails).toHaveLength(0);
  });
  it("4xx => failed confirmé ; 5xx/exception => issue inconnue (running conservé)", async () => {
    const f = mk({ sendEmail: async () => ({ ok: false, status: 422 }) });
    expect((await handleDailyReportCron(req(), f.d)).status).toBe(502);
    expect(f.finished[0]).toEqual(["2026-10-31", "failed", "provider_422", null]);
    const g = mk({ sendEmail: async () => ({ ok: false, status: 503 }) });
    await handleDailyReportCron(req(), g.d);
    expect(g.finished).toHaveLength(0);
    const x = mk({ sendEmail: async () => { throw new Error("net"); } });
    await handleDailyReportCron(req(), x.d);
    expect(x.finished).toHaveLength(0);
  });
  it("troncature signalée", async () => {
    const m = mk({ loadEvents: async () => ({ rows: [], truncated: true }) });
    await handleDailyReportCron(req(), m.d);
    expect(m.mails[0]!.html).toContain("chiffres tronqués");
  });
});

describe("contrat SQL d'installation", () => {
  const sql = readFileSync("docs/migrations-pending/reporting-contact.sql", "utf8");
  const active = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  it("additif, idempotent, isolé de V10", () => {
    expect(active).not.toMatch(/\bDROP\s+TABLE\b|\bTRUNCATE\b|ALTER TABLE public\.(?!tyre_rpt_)/i);
    expect(active).not.toMatch(/tyre_web_events|tyre_daily_reports|tyre_commercial_requests/);
    expect((active.match(/CREATE TABLE /g) ?? []).length).toBe((active.match(/CREATE TABLE IF NOT EXISTS public\.tyre_rpt_/g) ?? []).length);
  });
  it("URL de production du planificateur", () => {
    expect(sql).toContain("url := 'https://ddaconnectv2.lovable.app/api/public/tyres/reporting-daily'");
    expect(sql).not.toContain("project--");
    expect(active).toMatch(/snapshot_html = NULL/);
  });
  it("aucune tâche planifiée active, aucun secret en clair", () => {
    expect(active).not.toMatch(/cron\.schedule|cron\.alter_job|cron\.unschedule/);
    expect(active).not.toMatch(/Bearer\s+[A-Za-z0-9]{16,}/);
    expect(active).toContain("vault.create_secret(encode(extensions.gen_random_bytes(32)");
  });
  it("RPC réservées à service_role, pas d'écriture anon/authenticated", () => {
    for (const f of ["tyre_rpt_contact_begin", "tyre_rpt_contact_finish", "tyre_rpt_claim_report", "tyre_rpt_verify_cron_token", "tyre_rpt_purge"]) {
      expect(active).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon, authenticated`));
      expect(active).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO service_role`));
    }
    expect(active).not.toMatch(/TO anon/);
    expect(active).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*TO authenticated/);
  });
});
