import { beforeEach, describe, expect, it, vi } from "vitest";

const allBrands = vi.fn();
const legacy = vi.fn();
const districash = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/tire-provider.functions", () => ({
  fetchPublicTireOffersAllBrands: (a: unknown) => allBrands(a),
  fetchPublicTireOffers: (a: unknown) => legacy(a),
}));
vi.mock("@/lib/districash-quote.functions", () => ({ fetchDistricashQuoteRows: (a: unknown) => districash(a) }));

import { quoteManualTires, quoteOffers, quoteTopPriceTires } from "@/lib/tire-quotes";
import type { BrandTierRow } from "@/lib/tires";

const brands = [
  { brand: "Kumho", tier: "entree", active: true, is_default: true, sort_order: 1 },
  { brand: "Hankook", tier: "milieu", active: true, is_default: true, sort_order: 1 },
  { brand: "Michelin", tier: "haut", active: true, is_default: true, sort_order: 1 },
] as unknown as BrandTierRow[];
const engine = { settings: null, catalog: [], packages: [], brands } as never;

const it_ = (brand: string, ttc: number, season: "ete" | "quatre_saisons", sourceTier: string | null, ref: string, load = "91", speed = "V") => ({
  supplierRef: ref, brand, model: `${brand} ${ref}`, size: "205/55R16", loadIndex: load, speedIndex: speed, season, is3pmsf: false,
  publicPriceTtc: ttc, availability: null, sourceUrl: "u", consultedAt: "2026-10-31T00:00:00.000Z", sourceTier,
});
const legacyItems = [
  it_("Kumho", 72, "ete", "entree", "k1"), it_("Hankook", 96, "ete", "milieu", "h1"), it_("Michelin", 144, "ete", "haut", "m1"),
  it_("Kumho", 78, "quatre_saisons", "entree", "k2"), it_("Hankook", 102, "quatre_saisons", "milieu", "h2"), it_("Michelin", 150, "quatre_saisons", "haut", "m2"),
];
const args = { size: "205/55R16", load: "91", speed: "V", requestedBrand: null as string | null, quantity: 4, engine };

beforeEach(() => {
  legacy.mockResolvedValue({ ok: true, items: legacyItems, error: "", sourceUrl: "u", consultedAt: "x" });
  districash.mockResolvedValue({ ok: false, rows: [], error: "Districash : non configuré" });
  allBrands.mockImplementation(async ({ data }: { data: { season: string } }) => ({
    ok: true, error: "", truncated: false, pagesRead: 1,
    items: data.season === "ete"
      ? [it_("Linglong", 48, "ete", "entree", "l1"), it_("Nokian", 84, "ete", "milieu", "n1", "94", "W"), it_("Inconnue", 20, "ete", null, "x1"), it_("Bad", 30, "ete", "entree", "b1", "88"), it_("Pirelli", 130, "ete", "haut", "p1")]
      : [it_("Linglong", 54, "quatre_saisons", "entree", "l2")],
  }));
});

describe("Option fournisseur « Top prix » : même devis 6/7 offres", () => {
  it("garde les 6 cases d'origine (slots, titres, ordre) et prend le moins cher par case", async () => {
    const manual = await quoteManualTires({ ...args, supplier: "centralepneus" });
    const top = await quoteTopPriceTires({ ...args, siteId: "s1" });
    expect(top.grid.map((o) => [o.slot, o.title])).toEqual(manual.grid.map((o) => [o.slot, o.title]));
    expect(top.grid).toHaveLength(6);
    const by = Object.fromEntries(top.grid.map((o) => [o.slot, o]));
    expect(by.entree_ete!.brand).toBe("Linglong"); // marque hors paramétrage, gamme source fiable
    expect(by.milieu_ete!.brand).toBe("Nokian"); // 94W accepté pour 91V
    expect(by.haut_ete!.brand).toBe("Pirelli"); // moins cher que Michelin
    expect(by.entree_quatre_saisons!.brand).toBe("Linglong");
    expect(by.milieu_quatre_saisons!.brand).toBe("Hankook");
    expect(top.grid.some((o) => o.brand === "Inconnue" || o.brand === "Bad")).toBe(false);
    expect(top.warning).toMatch(/non classées.*INCONNUE/);
    expect(quoteOffers(top)).toHaveLength(6);
  });

  it("marque demandée : la 7e offre est conservée", async () => {
    const top = await quoteTopPriceTires({ ...args, requestedBrand: "Michelin" });
    expect(top.requested?.title).toBe("Marque demandée : Michelin");
    expect(top.requested?.brand).toBe("Michelin");
    expect(quoteOffers(top)).toHaveLength(7);
  });

  it("mode fournisseur inchangé : aucune consultation toutes marques", async () => {
    allBrands.mockClear();
    const manual = await quoteManualTires({ ...args, supplier: "centralepneus" });
    expect(allBrands).not.toHaveBeenCalled();
    expect(manual.grid.find((o) => o.slot === "entree_ete")!.brand).toBe("Kumho");
  });

  it("Districash : indices non transmis au portail en Top prix (minima appliqués localement)", async () => {
    districash.mockClear();
    await quoteTopPriceTires({ ...args, siteId: "s1" });
    expect(districash.mock.calls[0]![0].data).toMatchObject({ load: null, speed: null });
  });
});
