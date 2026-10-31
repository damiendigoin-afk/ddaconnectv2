import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { handleWebQuoteOptions, handleWebQuotePost, resetWebQuoteCache, type FacadeDeps } from "@/lib/tire-web-facade.server";
import { runTopPrice } from "@/lib/tire-top-price-core";
import { buildWebQuoteResponse, webReadiness, type WebQuoteConfig } from "@/lib/tire-web-api";
import type { BrandTierRow, PublicTireItem } from "@/lib/tires";

const ORIGIN = "https://dda-pneus-premiere-version.genialdrake34.chatgpt.site";
const cfg: WebQuoteConfig = { web_supplier: "top_prix", site_id: "site-1", enabled: true, allowed_origin: ORIGIN, quota_ip_per_10min: 10, quota_global_per_hour: 100 };
const brands = [
  { brand: "Kumho", tier: "entree", active: true, is_default: true, sort_order: 1 },
  { brand: "Hankook", tier: "milieu", active: true, is_default: true, sort_order: 1 },
  { brand: "Michelin", tier: "haut", active: true, is_default: true, sort_order: 1 },
] as unknown as BrandTierRow[];
const settings = { tire_margin_percent: 20, tire_margin_min_ht: 10 } as never;
const item = (brand: string, ttc: number, season: "ete" | "quatre_saisons", ref: string, extra: Partial<PublicTireItem> = {}): PublicTireItem => ({
  supplierRef: ref, brand, model: `${brand} M`, size: "205/55R16", loadIndex: "91", speedIndex: "V", season, is3pmsf: false,
  publicPriceTtc: ttc, availability: null, sourceUrl: "https://secret.example/achat", productUrl: "https://secret.example/p", consultedAt: "2026-10-31T00:00:00Z", sourceTier: null, ...extra,
});
const legacyItems = [item("Kumho", 72, "ete", "k1"), item("Hankook", 96, "ete", "h1"), item("Michelin", 144, "ete", "m1"), item("Kumho", 78, "quatre_saisons", "k2")];

let quotaCalls: string[];
let sourceCalls: number;
function deps(over: Partial<FacadeDeps> = {}, srcOver: Partial<ReturnType<FacadeDeps["sources"]>> = {}): FacadeDeps {
  return {
    loadConfig: async () => cfg,
    districashConfigured: async () => true,
    quotaHit: async (b) => { quotaCalls.push(b); return true; },
    loadEngine: async () => ({ settings, catalog: [], packages: [], brands }),
    sources: () => ({
      centraleAllBrands: async () => { sourceCalls++; return { ok: true, items: [], error: "", truncated: false, pagesRead: 1 }; },
      centraleLegacy: async () => { sourceCalls++; return { ok: true, items: legacyItems, error: "" }; },
      districash: async () => ({ ok: true, rows: [], error: "", consultedAt: "x" }),
      ...srcOver,
    }),
    runTopPrice,
    now: () => new Date("2026-10-31T12:00:00Z"),
    uuid: () => "q-test-1",
    ...over,
  };
}
const body = { width: 205, ratio: 55, rim: 16, loadIndex: 91, speedIndex: "V", quantity: 4 };
const req = (b: unknown = body, headers: Record<string, string> = {}) =>
  new Request("https://x/api/public/tyres/quotes", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": "1.2.3.4", ...headers },
    body: typeof b === "string" ? b : JSON.stringify(b),
  });

beforeEach(() => { resetWebQuoteCache(); quotaCalls = []; sourceCalls = 0; });

describe("Façade devis pneus web", () => {
  it("6 cases en liste blanche, prix en centimes selon la quantité, rien d'interne", async () => {
    const r = await handleWebQuotePost(req(), deps());
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const j = await r.json();
    expect(j.cases).toHaveLength(6);
    expect(j.cases.map((c: { tier: string; season: string }) => `${c.season}:${c.tier}`)).toEqual([
      "ete:entree", "ete:milieu", "ete:haut", "quatre_saisons:entree", "quatre_saisons:milieu", "quatre_saisons:haut",
    ]);
    const e = j.cases[0];
    expect(e).toMatchObject({ status: "available", brand: "Kumho", quantity: 4, currency: undefined });
    // 72 TTC public -> 60 HT ; marge max(20 %, 10 €) = 12 ; 72 HT vente ; ×4 = 288 HT = 345,60 TTC (sans montage paramétré)
    expect(e.totalTtcCents).toBe(34560);
    expect(Object.keys(e).sort()).toEqual(["availability", "brand", "compatibility", "compatibilityMessage", "includedServices", "loadIndex", "model", "quantity", "season", "size", "speedIndex", "status", "tier", "totalTtcCents"]);
    expect(j.cases[4].status).toBe("unavailable");
    expect(j.currency).toBe("EUR");
    expect(j.quoteId).toBe("q-test-1");
    expect(j.expiresAt).toBe("2026-10-31T12:15:00.000Z");
    const txt = JSON.stringify(j);
    for (const bad of ["secret.example", "unitSourceHt", "marginHt", "supplier", "k1", "CentralePneus", "Districash"]) expect(txt).not.toContain(bad);
  });

  it("quantité 2 : prix proportionnel", async () => {
    const j = await (await handleWebQuotePost(req({ ...body, quantity: 2 }), deps())).json();
    expect(j.cases[0].totalTtcCents).toBe(17280);
  });

  it("« à confirmer » préservé", () => {
    const res = buildWebQuoteResponse({
      grid: [{ slot: "entree_ete", available: true, totalTtc: 100, brand: "X", model: "Y", size: "205/55R16", loadIndex: "91", speedIndex: "H", quantity: 4, mountTtc: 40, mountLabel: "Montage 4 pneus", availability: "Disponible J", compatibility: "a_confirmer", compatibilityMessage: "Compatibilité à confirmer" } as never],
      input: body as never, partial: false, quoteId: "q", now: new Date(0),
    });
    expect(res.cases[0]).toMatchObject({ compatibility: "to_confirm", compatibilityMessage: "Compatibilité à confirmer", includedServices: [{ code: "montage", label: "Montage 4 pneus" }], totalTtcCents: 10000 });
  });

  it("désactivé ou configuration incomplète : 503 sans collecte", async () => {
    for (const d of [
      deps({ loadConfig: async () => ({ ...cfg, enabled: false }) }),
      deps({ loadConfig: async () => null }),
      deps({ loadConfig: async () => { throw new Error("db down"); } }),
      deps({ loadConfig: async () => ({ ...cfg, site_id: null }) }),
      deps({ districashConfigured: async () => false }),
    ]) {
      const r = await handleWebQuotePost(req(), d);
      expect(r.status).toBe(503);
      expect(JSON.stringify(await r.json())).not.toMatch(/db down|site|Districash/);
    }
    expect(sourceCalls).toBe(0);
    expect(quotaCalls).toEqual([]);
  });

  it("Districash exige un site : jamais prêt sans établissement", () => {
    expect(webReadiness({ ...cfg, site_id: null }, null).ok).toBe(false);
    expect(webReadiness(cfg, true).ok).toBe(true);
    expect(webReadiness({ ...cfg, web_supplier: "districash" }, true).ok).toBe(false);
  });

  it("entrées invalides refusées (champs inconnus, saison, quantité 3, taille)", async () => {
    for (const b of [{ ...body, season: "ete" }, { ...body, siteId: "x" }, { ...body, quantity: 3 }, { ...body, speedIndex: "v1" }, { ...body, width: "205" }, "{bad"]) {
      const r = await handleWebQuotePost(req(b), deps());
      expect(r.status).toBe(400);
    }
    const big = await handleWebQuotePost(req(JSON.stringify({ ...body, pad: "x".repeat(2000) })), deps());
    expect(big.status).toBe(413);
    expect(sourceCalls).toBe(0);
  });

  it("origine non autorisée : 403 ; OPTIONS autorisée 204", async () => {
    expect((await handleWebQuotePost(req(body, { origin: "https://evil.example" }), deps())).status).toBe(403);
    const o = await handleWebQuoteOptions(new Request("https://x", { method: "OPTIONS", headers: { origin: ORIGIN } }), deps());
    expect(o.status).toBe(204);
    expect(o.headers.get("access-control-allow-methods")).toContain("POST");
    expect((await handleWebQuoteOptions(new Request("https://x", { method: "OPTIONS", headers: { origin: "https://evil.example" } }), deps())).status).toBe(403);
  });

  it("quota dépassé : 429 avant toute collecte ; erreur quota : fermé (503)", async () => {
    const r = await handleWebQuotePost(req(), deps({ quotaHit: async () => false }));
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
    expect((await handleWebQuotePost(req(), deps({ quotaHit: async () => { throw new Error("x"); } }))).status).toBe(503);
    expect(sourceCalls).toBe(0);
  });

  it("empreinte IP sans IP en clair, quota par visiteur puis global", async () => {
    await handleWebQuotePost(req(), deps());
    expect(quotaCalls[0]).toMatch(/^ip:[0-9a-f]{24}$/);
    expect(quotaCalls[0]).not.toContain("1.2.3.4");
    expect(quotaCalls[1]).toBe("global");
  });

  it("cache et déduplication : une seule collecte pour deux demandes identiques", async () => {
    const d = deps();
    const [a, b] = await Promise.all([handleWebQuotePost(req(), d), handleWebQuotePost(req(), d)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    await handleWebQuotePost(req(), d);
    expect(sourceCalls).toBe(3); // 1 collecte = 2 saisons toutes marques + 1 consultation historique
  });

  it("panne partielle signalée sans fuite ; panne totale distincte (502)", async () => {
    const partial = await handleWebQuotePost(req(), deps({}, { districash: async () => ({ ok: false, rows: [], error: "Districash : mot de passe refusé", consultedAt: "" }) }));
    const pj = await partial.json();
    expect(pj.partial).toBe(true);
    expect(pj.notice).toBeTruthy();
    expect(JSON.stringify(pj)).not.toMatch(/mot de passe|Districash/);
    resetWebQuoteCache();
    const down = await handleWebQuotePost(req(), deps({}, {
      centraleAllBrands: async () => ({ ok: false, items: [], error: "x", truncated: false, pagesRead: 0 }),
      centraleLegacy: async () => ({ ok: false, items: [], error: "x" }),
      districash: async () => ({ ok: false, rows: [], error: "x", consultedAt: "" }),
    }));
    expect(down.status).toBe(502);
    expect((await down.json()).error.code).toBe("sources_unavailable");
  });

  it("zéro offre avec sources OK : 200, six cases indisponibles", async () => {
    const r = await handleWebQuotePost(req(), deps({}, { centraleLegacy: async () => ({ ok: true, items: [], error: "" }) }));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.cases.every((c: { status: string }) => c.status === "unavailable")).toBe(true);
  });

  it("délai global dépassé : 504", async () => {
    const r = await handleWebQuotePost(req(), deps({ timeoutMs: 20 }, { centraleLegacy: () => new Promise(() => {}) }));
    expect(r.status).toBe(504);
  });
});
