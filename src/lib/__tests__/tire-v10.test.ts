import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  aggregateTraffic, commercialReference, compareOffers, dailyReportWindow, deliveryOverall, eventsBatch,
  normalizeEvents, parisMidnightUtc, parseVerifiedDomains, senderFor, totalLabel, validUntil,
  fetchAllPages, loadBelowRequested, reportSendKey, FRONT_OFFICE_RECIPIENTS,
} from "@/lib/tire-v10";
import { commercialPdfLines, buildCommercialPdf, wrapText, PDF_PAGE, PDF_IDENTITY, type PdfLayoutItem } from "@/lib/tire-commercial-pdf";
import {
  handleCommercialRequest, handleDailyReport, handleEvents, handlePublicConfig,
  handleCommercialPreview, type CommercialDeps, type PrevRequest, type ReportDeps,
} from "@/lib/tire-v10.server";
import { verifyGoogleIdToken } from "@/lib/google-id-token";
import type { WebQuoteCase, WebQuoteConfig } from "@/lib/tire-web-api";

const B = "https://pneu.garagecastillon.fr";
const QID = "6f1c2a4e-1b2c-4d5e-8f90-123456789abc";
const RID = "0b7c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3";
const NOW = new Date("2026-11-01T13:00:00Z");
const cfg: WebQuoteConfig = { web_supplier: "top_prix", site_id: "s1", enabled: true, allowed_origins: [B], quota_ip_per_10min: 10, quota_global_per_hour: 100 };
const offer: WebQuoteCase = {
  tier: "milieu", season: "ete", status: "available", brand: "Hankook", model: "Ventus", size: "205/55R16", loadIndex: "91", speedIndex: "V",
  quantity: 4, totalTtcCents: 41234, includedServices: [{ code: "montage", label: "Montage équilibrage" }], compatibility: "to_confirm", compatibilityMessage: "Indice à confirmer",
};
const good = { requestId: RID, quoteId: QID, tier: "milieu", season: "ete", site: "castillon", name: "Jean Test", email: "jean@test.fr", phone: "06 00 00 00 00", consent: true };

function deps(over: Partial<CommercialDeps> = {}) {
  const store = new Map<string, PrevRequest>();
  const mails: { to: string; from: string; attachments: unknown[] }[] = [];
  const updates: Record<string, unknown>[] = [];
  const d: CommercialDeps = {
    v10Enabled: () => true, loadConfig: async () => cfg, quotaHit: async () => true, now: () => NOW,
    findRequest: async (id) => store.get(id) ?? null,
    loadQuote: async () => ({ expires_at: "2026-11-01T12:00:00Z", request: { size: "205/55R16", loadIndex: 91, speedIndex: "V", quantity: 4 }, cases: [offer] }),
    revalidate: async () => ({ status: 200, body: { quoteId: "new-q", expiresAt: "x", cases: [offer] } }),
    loadSite: async () => ({ id: "cas", contact_email: "fo@castillon.test" }),
    claimRequest: async (row) => {
      if (store.has(row['request_id'] as string)) return false;
      store.set(row['request_id'] as string, { payload_hash: row['payload_hash'] as string, response_status: null, response_body: null, delivery_status: "pending", created_at: NOW.toISOString() });
      return true;
    },
    storePdf: async () => undefined,
    updateRequest: async (id, p) => { updates.push(p); Object.assign(store.get(id)!, p); },
    recordServerEvent: async () => undefined,
    sendEmail: async (m) => { mails.push(m); return { ok: true }; },
    verifiedDomains: () => ["garagecastillon.fr"],
    googleClientId: () => null,
    verifyGoogle: async () => null,
    loadLogo: async () => ({ renault: null }),
    ipHash: async () => "h",
    ...over,
  };
  return { d, mails, updates, store };
}
const post = (body: unknown) =>
  new Request("https://x/api/public/tyres/commercial-requests", { method: "POST", headers: { origin: B, "content-type": "application/json" }, body: JSON.stringify(body) });

describe("V10 commercial request", () => {
  it("disabled flag => 503, no email", async () => {
    const { d, mails } = deps({ v10Enabled: () => false });
    expect((await handleCommercialRequest(post(good), d)).status).toBe(503);
    expect(mails).toHaveLength(0);
  });

  it("success: recorded, two emails with PDF, exact total, 7-day validity", async () => {
    const { d, mails } = deps();
    const r = await handleCommercialRequest(post(good), d);
    expect(r.status).toBe(201);
    const b = (await r.json()) as { totalTtcCents: number; validUntil: string; delivery: { overall: string } };
    expect(b.totalTtcCents).toBe(41234);
    expect(b.validUntil).toBe("2026-11-08T13:00:00.000Z");
    expect(b.delivery.overall).toBe("delivered");
    expect(mails.map((m) => m.to)).toEqual(["jean@test.fr", "contact@garagecastillon.fr"]);
    expect(mails.every((m) => m.from.includes("contact@garagecastillon.fr") && m.attachments.length === 1)).toBe(true);
  });

  it("price changed => 409 with new proposal, nothing recorded, no email", async () => {
    const claim = vi.fn(async () => true);
    const { d, mails } = deps({ claimRequest: claim, revalidate: async () => ({ status: 200, body: { quoteId: "q2", expiresAt: "e", cases: [{ ...offer, totalTtcCents: 42000 }] } }) });
    const r = await handleCommercialRequest(post(good), d);
    expect(r.status).toBe(409);
    const b = (await r.json()) as { error: { code: string }; changed: string[]; quoteId: string; offer: WebQuoteCase };
    expect(b.error.code).toBe("offer_changed");
    expect(b.changed).toEqual(["totalTtcCents"]);
    expect(b.quoteId).toBe("q2");
    expect(b.offer.totalTtcCents).toBe(42000);
    expect(claim).not.toHaveBeenCalled();
    expect(mails).toHaveLength(0);
  });

  it("model changed => 409", async () => {
    const { d } = deps({ revalidate: async () => ({ status: 200, body: { quoteId: "q2", expiresAt: "e", cases: [{ ...offer, model: "Kinergy" }] } }) });
    expect((await handleCommercialRequest(post(good), d)).status).toBe(409);
  });

  it("revalidation failure => 503 and no email", async () => {
    const { d, mails } = deps({ revalidate: async () => ({ status: 502, body: null }) });
    expect((await handleCommercialRequest(post(good), d)).status).toBe(503);
    expect(mails).toHaveLength(0);
  });

  it("retry with same requestId replays, never re-sends", async () => {
    const { d, mails } = deps();
    await handleCommercialRequest(post(good), d);
    const r2 = await handleCommercialRequest(post(good), d);
    expect(r2.status).toBe(201);
    expect(r2.headers.get("Idempotent-Replay")).toBe("true");
    expect(mails).toHaveLength(2);
  });

  it("same requestId with other content => 409 idempotency_conflict", async () => {
    const { d } = deps();
    await handleCommercialRequest(post(good), d);
    const r = await handleCommercialRequest(post({ ...good, phone: "07 11 11 11 11" }), d);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("idempotency_conflict");
  });

  it("concurrent double click: one send only", async () => {
    const { d, mails } = deps();
    const [a, b] = await Promise.all([handleCommercialRequest(post(good), d), handleCommercialRequest(post(good), d)]);
    for (const s of [a.status, b.status]) expect([201, 409]).toContain(s);
    expect(mails).toHaveLength(2);
  });

  it("unverified sender domain: recorded, no fallback, no email", async () => {
    const { d, mails } = deps({ verifiedDomains: () => ["garagecastillon.fr"] });
    const r = await handleCommercialRequest(post({ ...good, site: "lalinde" }), d);
    const b = (await r.json()) as { status: string; delivery: { overall: string; reason: string } };
    expect(b.status).toBe("recorded");
    expect(b.delivery).toMatchObject({ overall: "not_delivered", reason: "sender_not_verified" });
    expect(mails).toHaveLength(0);
  });

  it("PDF storage failure: no email", async () => {
    const { d, mails } = deps({ storePdf: async () => { throw new Error("x"); } });
    const b = (await (await handleCommercialRequest(post(good), d)).json()) as { delivery: { reason: string } };
    expect(b.delivery.reason).toBe("pdf_failed");
    expect(mails).toHaveLength(0);
  });

  it("one email failed => partial, not a fake success", async () => {
    let n = 0;
    const { d } = deps({ sendEmail: async () => ({ ok: n++ === 0 }) });
    const b = (await (await handleCommercialRequest(post(good), d)).json()) as { delivery: { overall: string } };
    expect(b.delivery.overall).toBe("partial");
  });

  it("phone and email required", async () => {
    const { d } = deps();
    const { phone: _p, ...noPhone } = good;
    expect((await handleCommercialRequest(post(noPhone), d)).status).toBe(400);
  });
});

describe("V10 rules", () => {
  it("compareOffers detects field changes", () => {
    expect(compareOffers(offer, offer).same).toBe(true);
    expect(compareOffers(offer, { ...offer, quantity: 2 }).changed).toEqual(["quantity"]);
    expect(compareOffers(offer, null).same).toBe(false);
  });
  it("senders: no fallback", () => {
    expect(senderFor("lalinde", parseVerifiedDomains("garagecastillon.fr")).ok).toBe(false);
    expect(senderFor("lalinde", parseVerifiedDomains("garagecastillon.fr, dda-lalinde.fr")).ok).toBe(true);
  });
  it("delivery overall", () => {
    expect(deliveryOverall("sent", "sent")).toBe("delivered");
    expect(deliveryOverall("sent", "not_configured")).toBe("partial");
    expect(deliveryOverall("failed", "failed")).toBe("not_delivered");
  });
  it("reference and validity", () => {
    expect(commercialReference(NOW, RID)).toBe("DDA-PN-20261101-0B7C1D");
    expect(validUntil(NOW).toISOString()).toBe("2026-11-08T13:00:00.000Z");
  });
});

describe("V10 PDF", () => {
  const data = { reference: "DDA-PN-1", issuedAt: NOW, validUntil: validUntil(NOW), customer: { name: "Jean Test", email: "jean@test.fr", phone: "0600" }, garageLabel: "Garage Castillon", offer };
  it("lines contain exact total, 7 days, reserve, signature, no definitive compatibility", () => {
    const l = commercialPdfLines(data).join("\n");
    expect(l).toContain("Total TTC, montage inclus : 412,34 €");
    expect(l).toContain("Valable 7 jours, jusqu'au 08/11/2026, sous réserve de disponibilité.");
    expect(l).toContain("Compatibilité avec votre véhicule à confirmer");
    expect(l).toContain("Nous, nous en prenons soin.");
    expect(l).not.toMatch(/compatible avec votre véhicule\b/i);
  });
  it("no montage => no 'monté' label", () => {
    expect(totalLabel({ includedServices: [] })).toBe("Total TTC");
  });
  it("renders a PDF", async () => {
    const b = await buildCommercialPdf(data, { renault: null });
    expect(new TextDecoder().decode(b.slice(0, 5))).toBe("%PDF-");
  });
  it("refuses unavailable offer", async () => {
    await expect(buildCommercialPdf({ ...data, offer: { ...offer, status: "unavailable", totalTtcCents: null } }, { renault: null })).rejects.toThrow();
  });
});

describe("V10 events", () => {
  const ev = (o: Record<string, unknown> = {}) => ({ eventId: crypto.randomUUID(), type: "page_view", page: "accueil", visitorId: "v".repeat(20), sessionId: "s".repeat(20), ...o });
  it("no consent => pseudonymous ids dropped", () => {
    const rows = normalizeEvents(eventsBatch.parse({ consent: { analytics: false }, events: [ev()] }), NOW);
    expect(rows[0]).toMatchObject({ visitor_id: null, session_id: null, consent: false });
  });
  it("dedupes eventId in batch, Paris hour", () => {
    const e = ev();
    const rows = normalizeEvents(eventsBatch.parse({ consent: { analytics: true }, events: [e, e] }), NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.paris_hour).toBe(14);
  });
  it("rejects request_submitted, free URLs and unknown fields", () => {
    expect(eventsBatch.safeParse({ consent: { analytics: true }, events: [ev({ type: "request_submitted" })] }).success).toBe(false);
    expect(eventsBatch.safeParse({ consent: { analytics: true }, events: [ev({ url: "https://x" })] }).success).toBe(false);
    expect(eventsBatch.safeParse({ consent: { analytics: true }, events: [ev({ email: "a@b.fr" })] }).success).toBe(false);
  });
  it("utm sanitized", () => {
    const rows = normalizeEvents(eventsBatch.parse({ consent: { analytics: true }, events: [ev({ utmSource: "Google", utmCampaign: "https://evil" })] }), NOW);
    expect(rows[0]).toMatchObject({ utm_source: "google", utm_campaign: null });
  });
  const req = (b: unknown) => new Request("https://x/e", { method: "POST", headers: { origin: B, "content-type": "application/json" }, body: JSON.stringify(b) });
  const base = { v10Enabled: () => true, loadConfig: async () => cfg, now: () => NOW, ipHash: async () => "h" };
  it("quota exceeded => 429, nothing inserted", async () => {
    const ins = vi.fn(async () => 1);
    const r = await handleEvents(req({ consent: { analytics: true }, events: [ev()] }), { ...base, quotaHit: async () => false, insertEvents: ins });
    expect(r.status).toBe(429);
    expect(ins).not.toHaveBeenCalled();
  });
  it("reports duplicates from DB", async () => {
    const r = await handleEvents(req({ consent: { analytics: true }, events: [ev(), ev()] }), { ...base, quotaHit: async () => true, insertEvents: async () => 1 });
    expect(await r.json()).toEqual({ accepted: 2, inserted: 1, duplicates: 1 });
  });
  it("aggregate never treats consented visitors as all visitors", () => {
    const rows = normalizeEvents(eventsBatch.parse({ consent: { analytics: false }, events: [ev(), ev()] }), NOW)
      .concat(normalizeEvents(eventsBatch.parse({ consent: { analytics: true }, events: [ev()] }), NOW));
    const a = aggregateTraffic(rows, []);
    expect(a.totals.pageViews).toBe(3);
    expect(a.consentCoverage.distinctVisitorsConsented).toBe(1);
    expect(a.consentCoverage.ratio).toBeCloseTo(1 / 3);
  });
});

describe("V10 public config", () => {
  it("google disabled explicitly, no secrets", async () => {
    const r = await handlePublicConfig(new Request("https://x", { headers: { origin: B } }), { v10Enabled: () => false, loadConfig: async () => cfg, quotaHit: async () => true, now: () => NOW, googleClientId: () => null });
    const b = (await r.json()) as Record<string, unknown>;
    expect(b['enabled']).toBe(false);
    expect(b['google']).toEqual({ enabled: false, clientId: null });
    expect(JSON.stringify(b)).not.toMatch(/secret|password|api_?key|token/i);
  });
});

describe("V10 daily report", () => {
  it("DST windows: 23h in spring, 25h in autumn", () => {
    const spring = dailyReportWindow(new Date("2026-03-30T05:00:00Z")); // 07:00 CEST
    expect(spring).toMatchObject({ shouldRun: true, reportDate: "2026-03-29" });
    expect((spring.end.getTime() - spring.start.getTime()) / 3600000).toBe(23);
    const fall = dailyReportWindow(new Date("2026-10-26T06:00:00Z")); // 07:00 CET
    expect(fall).toMatchObject({ shouldRun: true, reportDate: "2026-10-25" });
    expect((fall.end.getTime() - fall.start.getTime()) / 3600000).toBe(25);
    expect(dailyReportWindow(new Date("2026-10-26T05:00:00Z")).shouldRun).toBe(false);
    expect(parisMidnightUtc("2026-07-01").toISOString()).toBe("2026-06-30T22:00:00.000Z");
  });
  function rdeps(over: Partial<ReportDeps> = {}) {
    const done = new Set<string>();
    const mails: { to: string; idempotencyKey: string }[] = [];
    const d: ReportDeps = {
      v10Enabled: () => true, secret: () => "x".repeat(40), now: () => new Date("2026-11-02T06:05:00Z"),
      loadPeriod: async () => ({ events: [], requests: [{ created_at: "", site_key: "lalinde", prospect_status: "nouveau", delivery_status: "delivered" }], pending: [] }),
      claimReport: async (k) => (done.has(k) ? null : (done.add(k), { sendKey: `tyres-daily-report-${k}` })),
      finishReport: async () => undefined,
      sendEmail: async (m) => { mails.push(m); return { ok: true }; },
      verifiedDomains: () => ["garagecastillon.fr"],
      ...over,
    };
    return { d, mails };
  }
  const call = (tok = "x".repeat(40)) => new Request("https://x/r", { method: "POST", headers: { authorization: `Bearer ${tok}` } });
  it("auth required, single recipient, idempotent", async () => {
    const { d, mails } = rdeps();
    expect((await handleDailyReport(call("bad"), d)).status).toBe(401);
    expect((await handleDailyReport(call(), d)).status).toBe(200);
    const again = (await (await handleDailyReport(call(), d)).json()) as { skipped: string };
    expect(again.skipped).toBe("already_done");
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: "damien@garagecastillon.fr", idempotencyKey: "tyres-daily-report-2026-11-01" });
  });
  it("no secret configured => inactive", async () => {
    const { d, mails } = rdeps({ secret: () => null });
    expect((await handleDailyReport(call(), d)).status).toBe(503);
    expect(mails).toHaveLength(0);
  });
});

describe("Google id_token", () => {
  async function sign(claims: Record<string, unknown>) {
    const kp = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as { n: string; e: string };
    const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const data = `${enc({ alg: "RS256", kid: "k1" })}.${enc(claims)}`;
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(data)));
    const s = btoa(String.fromCharCode(...sig)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    return { token: `${data}.${s}`, keys: [{ kid: "k1", kty: "RSA" as const, n: jwk.n, e: jwk.e }] };
  }
  const ok = { iss: "https://accounts.google.com", aud: "cid", exp: NOW.getTime() / 1000 + 600, email: "Jean@Test.fr", email_verified: true, name: "Jean" };
  it("accepts valid, rejects aud / expired / unverified", async () => {
    for (const [c, expected] of [[ok, true], [{ ...ok, aud: "other" }, "aud"], [{ ...ok, exp: 1 }, "expired"], [{ ...ok, email_verified: false }, "email_unverified"]] as const) {
      const { token, keys } = await sign(c);
      const r = await verifyGoogleIdToken(token, { clientId: "cid", now: NOW, getKeys: async () => keys });
      if (expected === true) expect(r).toEqual({ ok: true, identity: { email: "jean@test.fr", name: "Jean" } });
      else expect(r).toEqual({ ok: false, reason: expected });
    }
  });
});

describe("V10 revue — correctifs", () => {
  const weak: WebQuoteCase = { ...offer, loadIndex: "88" };
  const quoteWith = (c: WebQuoteCase) => async () => ({ expires_at: "2026-11-01T14:00:00Z", request: { size: "205/55R16", loadIndex: 91, speedIndex: "V", quantity: 4 }, cases: [c] });

  it("loadBelowRequested: connu inférieur refusé, inconnu/égal/supérieur non", () => {
    expect(loadBelowRequested("88", 91)).toBe(true);
    expect(loadBelowRequested("94/90", 91)).toBe(true);
    expect(loadBelowRequested("91", 91)).toBe(false);
    expect(loadBelowRequested("95", 91)).toBe(false);
    expect(loadBelowRequested(null, 91)).toBe(false);
  });

  it("request: offre acceptée sous la charge demandée => 422, rien enregistré ni envoyé", async () => {
    const { d, mails, store } = deps({ loadQuote: quoteWith(weak) });
    const r = await handleCommercialRequest(post(good), d);
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("offer_load_insufficient");
    expect(store.size).toBe(0);
    expect(mails).toHaveLength(0);
  });

  it("request: offre FRAÎCHE sous la charge => 422 avant enregistrement", async () => {
    const { d, mails, store } = deps({ revalidate: async () => ({ status: 200, body: { quoteId: "n", expiresAt: "x", cases: [weak] } }) });
    expect((await handleCommercialRequest(post(good), d)).status).toBe(422);
    expect(store.size).toBe(0);
    expect(mails).toHaveLength(0);
  });

  it("preview: offre sous la charge => 422, pas de PDF", async () => {
    const { d } = deps({ loadQuote: quoteWith(weak) });
    const req = new Request("https://x/p", { method: "POST", headers: { origin: B, "content-type": "application/json" }, body: JSON.stringify({ quoteId: QID, tier: "milieu", season: "ete", site: "castillon", name: "J T", email: "j@t.fr", phone: "06 00 00 00 00" }) });
    const r = await handleCommercialPreview(req, d);
    expect(r.status).toBe(422);
  });

  it("Front Office: destinataire validé exact même si sites.contact_email diffère", async () => {
    expect(FRONT_OFFICE_RECIPIENTS).toEqual({ castillon: "contact@garagecastillon.fr", lalinde: "contact@dda-lalinde.fr" });
    const { d, mails } = deps({ loadSite: async () => ({ id: "lal", contact_email: "autre@exemple.fr" }), verifiedDomains: () => ["dda-lalinde.fr"] });
    const r = await handleCommercialRequest(post({ ...good, site: "lalinde" }), d);
    const b = (await r.json()) as { delivery: { frontOfficeRecipientMismatch: boolean } };
    expect(mails.map((m) => m.to)).toEqual(["jean@test.fr", "contact@dda-lalinde.fr"]);
    expect(b.delivery.frontOfficeRecipientMismatch).toBe(true);
  });

  it("échec persistant de l'écriture finale: rejeu => 202 statut inconnu, aucun renvoi", async () => {
    let n = 0;
    const ctx = deps();
    const base = ctx.d.updateRequest;
    ctx.d.updateRequest = async (id, p) => { n++; if (p["response_body"]) throw new Error("db"); return base(id, p); };
    const r1 = await handleCommercialRequest(post(good), ctx.d);
    expect(r1.status).toBe(201);
    expect(n).toBe(4); // 1 « sending » + 3 tentatives finales
    expect(ctx.mails).toHaveLength(2);
    const r2 = await handleCommercialRequest(post(good), ctx.d);
    expect(r2.status).toBe(202);
    expect(((await r2.json()) as { delivery: { overall: string } }).delivery.overall).toBe("unknown");
    expect(ctx.mails).toHaveLength(2);
  });

  it("marquage « sending » impossible => aucun e-mail", async () => {
    const ctx = deps();
    const base = ctx.d.updateRequest;
    ctx.d.updateRequest = async (id, p) => { if (p["delivery_status"] === "sending") throw new Error("db"); return base(id, p); };
    const b = (await (await handleCommercialRequest(post(good), ctx.d)).json()) as { delivery: { reason: string; overall: string } };
    expect(ctx.mails).toHaveLength(0);
    expect(b.delivery).toMatchObject({ reason: "status_not_saved", overall: "not_delivered" });
  });

  it("succès: message sans prétendre la réception en boîte", async () => {
    const { d } = deps();
    const b = (await (await handleCommercialRequest(post(good), d)).json()) as { message: string };
    expect(b.message).not.toMatch(/vous a été envoyé/);
  });

  it("fetchAllPages: lit au-delà de 1000 et signale le plafond", async () => {
    const all = Array.from({ length: 2500 }, (_, k) => k);
    const page = async (a: number, b: number) => ({ data: all.slice(a, Math.min(b, a + 999) + 1), error: null });
    const full = await fetchAllPages(page);
    expect(full).toMatchObject({ truncated: false });
    expect(full.rows).toHaveLength(2500);
    const capped = await fetchAllPages(page, { maxRows: 2000 });
    expect(capped.rows).toHaveLength(2000);
    expect(capped.truncated).toBe(true);
  });

  it("rapport: réessai après échec confirmé avec nouvelle clé, issue inconnue garde la clé", async () => {
    expect(reportSendKey("2026-11-01", "none", 1, null)).toBe("tyres-daily-report-2026-11-01");
    expect(reportSendKey("2026-11-01", "failed", 2, "tyres-daily-report-2026-11-01")).toBe("tyres-daily-report-2026-11-01-r2");
    expect(reportSendKey("2026-11-01", "stale", 3, "tyres-daily-report-2026-11-01-r2")).toBe("tyres-daily-report-2026-11-01-r2");
    // Simulation claim : échec puis reprise.
    let status: "none" | "running" | "failed" | "sent" = "none";
    let attempts = 0;
    const keys: string[] = [];
    const d: ReportDeps = {
      v10Enabled: () => true, secret: () => "x".repeat(40), now: () => new Date("2026-11-02T06:00:00Z"),
      loadPeriod: async () => ({ events: [], requests: [], pending: [] }),
      claimReport: async (k) => {
        if (status === "running" || status === "sent") return null;
        attempts++;
        const prev = status === "failed" ? "failed" : "none";
        status = "running";
        return { sendKey: reportSendKey(k, prev, attempts, null) };
      },
      finishReport: async (_k, p) => { status = p.status; },
      sendEmail: async (m) => { keys.push(m.idempotencyKey); return keys.length === 1 ? { ok: false, error: "x" } : { ok: true }; },
      verifiedDomains: () => ["garagecastillon.fr"],
    };
    const call = () => new Request("https://x/r", { method: "POST", headers: { authorization: `Bearer ${"x".repeat(40)}` } });
    expect((await handleDailyReport(call(), d)).status).toBe(502);
    expect((await handleDailyReport(call(), d)).status).toBe(200);
    expect(((await (await handleDailyReport(call(), d)).json()) as { skipped: string }).skipped).toBe("already_done");
    expect(keys).toEqual(["tyres-daily-report-2026-11-01", "tyres-daily-report-2026-11-01-r2"]);
  });

  it("garde 7 h Paris pour un appel horaire 0 * * * * UTC", () => {
    expect(dailyReportWindow(new Date("2026-11-02T06:00:00Z")).shouldRun).toBe(true); // 07:00 CET
    expect(dailyReportWindow(new Date("2026-07-02T05:00:00Z")).shouldRun).toBe(true); // 07:00 CEST
    expect(dailyReportWindow(new Date("2026-07-02T06:00:00Z")).shouldRun).toBe(false);
  });
});

describe("V10 PDF — mise en page", () => {
  const base = { reference: "DDA-PN-1", issuedAt: NOW, validUntil: validUntil(NOW), customer: { name: "Jean Test", email: "jean@test.fr", phone: "0600" }, garageLabel: "Garage Castillon", offer };
  const overlaps = (a: PdfLayoutItem, b: PdfLayoutItem) => a.page === b.page && a.y < b.y + b.height && b.y < a.y + a.height;
  it("encadré total ne recouvre aucune ligne précédente, total exact", async () => {
    const L: PdfLayoutItem[] = [];
    await buildCommercialPdf(base, { renault: null }, L);
    const box = L.find((i) => i.kind === "box")!;
    const before = L.slice(0, L.indexOf(box)).filter((i) => i.kind === "text" && i.page === box.page);
    for (const t of before) expect(overlaps(t, box)).toBe(false);
    expect(L.some((i) => i.text === "Total TTC, montage inclus : 412,34 €".replace("€", "€"))).toBe(true);
  });
  it("identité imprimée même sans logo", async () => {
    const L: PdfLayoutItem[] = [];
    await buildCommercialPdf(base, { renault: null }, L);
    expect(L.some((i) => i.text === PDF_IDENTITY.name)).toBe(true);
    expect(L.some((i) => i.text === "LE SENS DU SERVICE")).toBe(true);
  });
  it("wrapText coupe un mot sans espace plus long que la largeur", () => {
    const m = (t: string) => t.length * 5;
    const out = wrapText("a".repeat(255), 100, m);
    expect(out.every((l) => m(l) <= 100)).toBe(true);
    expect(out.join("")).toBe("a".repeat(255));
  });
  it("données longues : largeur respectée, pagination, rien sous le pied/aperçu", async () => {
    const long = {
      ...base, preview: true,
      customer: { name: "N".repeat(100), email: `${"e".repeat(243)}@exemple.fr`, phone: "0600" },
      offer: { ...offer, model: "M".repeat(300), includedServices: Array.from({ length: 60 }, (_, k) => ({ code: `s${k}`, label: `Prestation fournisseur très longue numéro ${k}` })), compatibilityMessage: "C ".repeat(400) },
    };
    const L: PdfLayoutItem[] = [];
    const b = await buildCommercialPdf(long, { renault: null }, L);
    expect(new TextDecoder().decode(b.slice(0, 5))).toBe("%PDF-");
    const body = L.filter((i) => i.text !== PDF_IDENTITY.name && i.text !== PDF_IDENTITY.tagline);
    expect(Math.max(...L.map((i) => i.page))).toBeGreaterThan(0);
    for (const i of body) {
      expect(i.y).toBeGreaterThanOrEqual(PDF_PAGE.previewFooterTop - 0.01);
      expect(i.x + i.width).toBeLessThanOrEqual(PDF_PAGE.W - PDF_PAGE.M + 0.01);
    }
    const box = L.find((i) => i.kind === "box")!;
    for (const t of L.filter((i) => i.kind === "text" && i !== box && !/^Total/.test(i.text ?? ""))) expect(overlaps(t, box)).toBe(false);
  });
});
