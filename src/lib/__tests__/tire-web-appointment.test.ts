import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { handleAppointmentOptions, handleAppointmentPost, type AppointmentDeps } from "@/lib/tire-web-appointment.server";
import { corsHeaders, type WebQuoteCase, type WebQuoteConfig } from "@/lib/tire-web-api";

const A = "https://dda-pneus-premiere-version.genialdrake34.chatgpt.site";
const B = "https://pneu.garagecastillon.fr";
const QID = "6f1c2a4e-1b2c-4d5e-8f90-123456789abc";
const NOW = new Date("2026-10-31T12:00:00Z");
const cfg: WebQuoteConfig = { web_supplier: "top_prix", site_id: "s1", enabled: true, allowed_origins: [A, B], quota_ip_per_10min: 10, quota_global_per_hour: 100 };
const offer: WebQuoteCase = {
  tier: "milieu", season: "ete", status: "available", brand: "Hankook", model: "K", size: "205/55R16", loadIndex: "91", speedIndex: "V",
  quantity: 4, totalTtcCents: 41234, includedServices: [], compatibility: "compatible", compatibilityMessage: null,
};
const good = {
  quoteId: QID, site: "lalinde", siteChoiceMethod: "manual", tier: "milieu", season: "ete", name: "Jean Test", phone: "06 00 00 00 00",
  preferredSlots: [{ date: "2026-11-03", period: "matin" }], consent: true, website: "", formElapsedMs: 15000,
};

function deps(over: Partial<AppointmentDeps> = {}) {
  const rows: Record<string, unknown>[] = [];
  const mails: { to: string; subject: string; html: string }[] = [];
  const notes: { notification_status: string }[] = [];
  const d: AppointmentDeps = {
    loadConfig: async () => cfg,
    quotaHit: async () => true,
    loadQuote: async () => ({ expires_at: "2026-10-31T12:10:00Z", cases: [offer] }),
    insertRequest: async (r) => { rows.push(r); return "req-1"; },
    loadSite: async (code) => (code === "dda" ? { id: "lal", contact_email: "accueil@lalinde.test" } : code === "castillon" ? { id: "cas", contact_email: null } : null),
    sendEmail: async (m) => { mails.push(m); return { ok: true }; },
    updateNotification: async (_id, p) => { notes.push(p); },
    now: () => NOW,
    ...over,
  };
  return { d, rows, mails, notes };
}
const post = (body: unknown, origin = B) =>
  new Request("https://x/api/public/tyres/appointment-requests", {
    method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body),
  });

describe("demande de RDV pneus site web", () => {
  it("CORS : les deux domaines du site sont autorisés, aucun autre", async () => {
    expect(corsHeaders(A, cfg.allowed_origins)["Access-Control-Allow-Origin"]).toBe(A);
    expect(corsHeaders(B, cfg.allowed_origins)["Access-Control-Allow-Origin"]).toBe(B);
    expect(corsHeaders("https://evil.garagecastillon.fr", cfg.allowed_origins)["Access-Control-Allow-Origin"]).toBeUndefined();
    const r = await handleAppointmentOptions(new Request("https://x", { method: "OPTIONS", headers: { origin: "https://evil.com" } }), deps().d);
    expect(r.status).toBe(403);
  });

  it("crée une demande « à confirmer » avec l'offre relue du devis serveur", async () => {
    const { d, rows } = deps();
    const r = await handleAppointmentPost(post({ ...good }), d);
    expect(r.status).toBe(201);
    expect((await r.json()).status).toBe("a_confirmer");
    const row = rows[0] ?? {};
    expect(row["status"]).toBe("a_confirmer");
    expect((row["offer_snapshot"] as WebQuoteCase).totalTtcCents).toBe(41234);
    expect(row["site_id"]).toBe("lal");
  });

  it("un prix fourni par le navigateur est refusé (champ inconnu)", async () => {
    const { d, rows } = deps();
    const r = await handleAppointmentPost(post({ ...good, totalTtcCents: 1 }), d);
    expect(r.status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  it("désactivé => 503, rien enregistré", async () => {
    const { d, rows } = deps({ loadConfig: async () => ({ ...cfg, enabled: false }) });
    expect((await handleAppointmentPost(post(good), d)).status).toBe(503);
    expect(rows).toHaveLength(0);
  });

  it("pot de miel ou saisie trop rapide : réponse neutre sans enregistrement", async () => {
    for (const b of [{ ...good, website: "http://spam" }, { ...good, formElapsedMs: 500 }]) {
      const { d, rows } = deps();
      expect((await handleAppointmentPost(post(b), d)).status).toBe(202);
      expect(rows).toHaveLength(0);
    }
  });

  it("téléphone ou e-mail obligatoire, consentement obligatoire", async () => {
    const { phone: _p, ...noContact } = good;
    expect((await handleAppointmentPost(post(noContact), deps().d)).status).toBe(400);
    expect((await handleAppointmentPost(post({ ...good, consent: false }), deps().d)).status).toBe(400);
  });

  it("devis expiré ou inconnu => 409 ; case indisponible => 422", async () => {
    expect((await handleAppointmentPost(post(good), deps({ loadQuote: async () => null }).d)).status).toBe(409);
    expect((await handleAppointmentPost(post(good), deps({ loadQuote: async () => ({ expires_at: "2026-10-31T11:00:00Z", cases: [offer] }) }).d)).status).toBe(409);
    const un = { ...offer, status: "unavailable" as const };
    expect((await handleAppointmentPost(post(good), deps({ loadQuote: async () => ({ expires_at: "2026-10-31T13:00:00Z", cases: [un] }) }).d)).status).toBe(422);
  });

  it("quota dépassé => 429 sans enregistrement", async () => {
    const { d, rows } = deps({ quotaHit: async () => false });
    expect((await handleAppointmentPost(post(good), d)).status).toBe(429);
    expect(rows).toHaveLength(0);
  });

  it("créneau passé refusé", async () => {
    const r = await handleAppointmentPost(post({ ...good, preferredSlots: [{ date: "2026-10-01", period: "matin" }] }), deps().d);
    expect(r.status).toBe(400);
  });

  it("notifie le front office du garage CHOISI, sans prix d'achat", async () => {
    const { d, mails, notes } = deps();
    await handleAppointmentPost(post({ ...good, site: "lalinde" }), d);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.to).toBe("accueil@lalinde.test");
    expect(mails[0]?.html).toContain("412,34 € TTC");
    expect(mails[0]?.html).not.toMatch(/achat|HT/);
    expect(notes[0]?.notification_status).toBe("sent");
  });

  it("adresse d'accueil absente : demande conservée, état not_configured, aucun envoi", async () => {
    const { d, rows, mails, notes } = deps();
    const r = await handleAppointmentPost(post({ ...good, site: "castillon" }), d);
    expect(r.status).toBe(201);
    expect(rows[0]?.["site_id"]).toBe("cas");
    expect(mails).toHaveLength(0);
    expect(notes[0]?.notification_status).toBe("not_configured");
  });

  it("échec d'envoi : demande conservée, état failed (pas de faux succès)", async () => {
    const { d, rows, notes } = deps({ sendEmail: async () => ({ ok: false, error: "refus" }) });
    expect((await handleAppointmentPost(post(good), d)).status).toBe(201);
    expect(rows).toHaveLength(1);
    expect(notes[0]?.notification_status).toBe("failed");
  });

  it("garage inconnu refusé ; garage inactif => 422", async () => {
    expect((await handleAppointmentPost(post({ ...good, site: "paris" }), deps().d)).status).toBe(400);
    expect((await handleAppointmentPost(post(good), deps({ loadSite: async () => null }).d)).status).toBe(422);
  });
});
