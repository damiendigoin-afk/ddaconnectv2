import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { handleContactOptions, handleContactPost, type ContactDeps } from "@/lib/tire-web-contact.server";
import type { WebQuoteCase, WebQuoteConfig } from "@/lib/tire-web-api";

const A = "https://dda-pneus-premiere-version.genialdrake34.chatgpt.site";
const B = "https://pneu.garagecastillon.fr";
const NOW = new Date("2026-11-01T12:00:00Z");
const cfg: WebQuoteConfig = { web_supplier: "top_prix", site_id: "s1", enabled: true, allowed_origins: [A, B], quota_ip_per_10min: 10, quota_global_per_hour: 100 };
const offer: WebQuoteCase = {
  tier: "milieu", season: "ete", status: "available", brand: "Hankook", model: "Ventus <b>", size: "205/55R16", loadIndex: "91", speedIndex: "V",
  quantity: 4, totalTtcCents: 41234, includedServices: [{ code: "montage", label: "Montage équilibrage" }], compatibility: "to_confirm", compatibilityMessage: "À confirmer",
};
const good = {
  requestId: "11111111-2222-4333-8444-555555555555", quoteId: "6f1c2a4e-1b2c-4d5e-8f90-123456789abc",
  tier: "milieu", season: "ete", site: "castillon", name: "Jean <script>", email: "jean@client.test", phone: "06 00 00 00 00",
  message: "Bonjour & merci", consent: true, website: "",
};

function deps(over: Partial<ContactDeps> = {}) {
  const mails: Parameters<ContactDeps["sendEmail"]>[0][] = [];
  const d: ContactDeps = {
    loadConfig: async () => cfg,
    quotaHit: async () => true,
    loadQuote: async () => ({ created_at: "2026-11-01T11:58:00Z", expires_at: "2026-11-01T12:10:00Z", cases: [offer] }),
    sendEmail: async (m) => { mails.push(m); return { ok: true, id: "re_1", status: 200 }; },
    now: () => NOW,
    ...over,
  };
  return { d, mails };
}
const post = (body: unknown, origin = B) =>
  new Request("https://x/api/public/tyres/contact-request", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });

describe("contact-request pneus", () => {
  it("routage vers les deux garages, un seul mail, Reply-To client, pas de pièce jointe", async () => {
    for (const [site, to] of [["castillon", "contact@garagecastillon.fr"], ["lalinde", "contact@dda-lalinde.fr"]] as const) {
      const { d, mails } = deps();
      const r = await handleContactPost(post({ ...good, site }), d);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ requestId: good.requestId, status: "sent", garage: site });
      expect(mails).toHaveLength(1);
      expect(mails[0]!.to).toBe(to);
      expect(mails[0]!.replyTo).toBe("jean@client.test");
      expect(mails[0]).not.toHaveProperty("attachments");
      expect(mails[0]!.idempotencyKey).toBe(`tyres-contact-${good.requestId}`);
    }
  });

  it("contenu : prix exact du devis stocké, date tarif, HTML échappé", async () => {
    const { d, mails } = deps();
    await handleContactPost(post(good), d);
    const h = mails[0]!.html;
    expect(h).toContain("412,34");
    expect(h).toContain("01/11/2026 12:58");
    expect(h).not.toContain("<script>");
    expect(h).toContain("Jean &lt;script&gt;");
    expect(h).toContain("Ventus &lt;b&gt;");
    expect(h).toContain("Bonjour &amp; merci");
  });

  it("corps stable dans le temps (idempotence fournisseur)", async () => {
    const a = deps(); const b = deps({ now: () => new Date("2026-11-01T12:09:00Z") });
    await handleContactPost(post(good), a.d); await handleContactPost(post(good), b.d);
    expect(a.mails[0]).toEqual(b.mails[0]);
  });

  it("même requestId avec autre contenu : conflit 409 relayé", async () => {
    const { d } = deps({ sendEmail: async () => ({ ok: false, status: 409, error: "invalid_idempotent_request" }) });
    expect((await handleContactPost(post({ ...good, message: "autre" }), d)).status).toBe(409);
  });

  it("origine refusée, OPTIONS exact", async () => {
    const { d, mails } = deps();
    expect((await handleContactPost(post(good, "https://evil.com"), d)).status).toBe(403);
    expect(mails).toHaveLength(0);
    expect((await handleContactOptions(new Request("https://x", { method: "OPTIONS", headers: { origin: A } }), d)).status).toBe(204);
    expect((await handleContactOptions(new Request("https://x", { method: "OPTIONS", headers: { origin: "https://evil.com" } }), d)).status).toBe(403);
  });

  it("validation : prix client refusé, consentement, site, message trop long, email", async () => {
    for (const b of [
      { ...good, totalTtcCents: 1 }, { ...good, consent: false }, { ...good, site: "paris" },
      { ...good, message: "x".repeat(501) }, { ...good, email: "pas-un-mail" }, { ...good, requestId: "1" },
    ]) {
      const { d, mails } = deps();
      expect((await handleContactPost(post(b), d)).status).toBe(400);
      expect(mails).toHaveLength(0);
    }
  });

  it("désactivé => 503 ; honeypot => aucun envoi ; quota => 429", async () => {
    let x = deps({ loadConfig: async () => ({ ...cfg, enabled: false }) });
    expect((await handleContactPost(post(good), x.d)).status).toBe(503);
    x = deps();
    const r = await handleContactPost(post({ ...good, website: "spam" }), x.d);
    expect(r.status).toBe(202); expect((await r.json()).status).not.toBe("sent"); expect(x.mails).toHaveLength(0);
    x = deps({ quotaHit: async () => false });
    expect((await handleContactPost(post(good), x.d)).status).toBe(429); expect(x.mails).toHaveLength(0);
  });

  it("erreurs mail : jamais de faux succès (refus, sans id, exception)", async () => {
    for (const s of [
      async () => ({ ok: false, status: 500, error: "x" }),
      async () => ({ ok: true, status: 200 }),
      async () => { throw new Error("net"); },
    ] as ContactDeps["sendEmail"][]) {
      const r = await handleContactPost(post(good), deps({ sendEmail: s }).d);
      expect(r.status).toBe(502);
    }
  });

  it("devis expiré ou offre absente : aucun envoi", async () => {
    let x = deps({ loadQuote: async () => ({ created_at: "", expires_at: "2026-11-01T11:00:00Z", cases: [offer] }) });
    expect((await handleContactPost(post(good), x.d)).status).toBe(409);
    x = deps();
    expect((await handleContactPost(post({ ...good, tier: "haut" }), x.d)).status).toBe(422);
    expect(x.mails).toHaveLength(0);
  });

  it("aucune dépendance PDF/CRM/calcul dans le module", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/lib/tire-web-contact.server.ts", "utf8");
    for (const bad of ["pdf-lib", "buildCommercialPdf", "freshWebQuote", "runTopPrice", "quoteTopPrice", "insert(", "upsert(", "storage", "sendEmailWithAttachments"])
      expect(src).not.toContain(bad);
  });
  it("libellé du total : « monté » seulement si le montage est réellement inclus", async () => {
    const { d, mails } = deps({ loadQuote: async () => ({ created_at: "2026-11-01T11:58:00Z", expires_at: "2026-11-01T12:10:00Z", cases: [{ ...offer, includedServices: [] }] }) });
    await handleContactPost(post(good), d);
    const h = mails[0]!.html;
    expect(h).toContain("Total TTC</td>");
    expect(h).not.toContain("Total TTC mont\u00e9");
    expect(h).toContain("412,34");
  });
});
