import { describe, expect, it } from "vitest";
import { offerMeetsRequirement, pickTopPriceOffers, type BrandTierRow, type TireOffer } from "@/lib/tires";
import { meetsIndicesStrict } from "@/lib/tire-top-price-source";

const ok = (load: string, speed: string, season: "ete" | "quatre_saisons" | "hiver" = "ete", is3pmsf = false) =>
  offerMeetsRequirement({ offerLoad: load, offerSpeed: speed, season, is3pmsf, requiredLoad: "91", requiredSpeed: "V" });

describe("Indices = minima (91V demandé)", () => {
  it("accepte 91V, 94V, 91W, 94W, 91Y", () => {
    for (const [l, s] of [["91", "V"], ["94", "V"], ["91", "W"], ["94", "W"], ["91", "Y"]]) expect(ok(l!, s!)).toBe(true);
  });
  it("refuse 88V et 91H en été, ordre réglementaire (H < V)", () => {
    expect(ok("88", "V")).toBe(false);
    expect(ok("91", "H")).toBe(false);
    expect(ok("91", "T")).toBe(false);
  });
  it("dérogation 3PMSF : un cran en dessous en 4 saisons / hiver uniquement", () => {
    expect(ok("91", "H", "quatre_saisons", true)).toBe(true);
    expect(ok("91", "H", "hiver", true)).toBe(true);
    expect(ok("91", "H", "quatre_saisons", false)).toBe(false);
    expect(ok("91", "T", "quatre_saisons", true)).toBe(false); // deux crans
    expect(ok("91", "H", "ete", true)).toBe(false);
    expect(ok("88", "V", "quatre_saisons", true)).toBe(false); // jamais sur la charge
  });
  it("pré-filtre de pagination en minima", () => {
    const m = (l: string, s: string) => meetsIndicesStrict({ loadIndex: l, speedIndex: s }, "91", "V");
    expect([m("94", "V"), m("91", "W"), m("94", "W")]).toEqual([true, true, true]);
    expect([m("88", "V"), m("91", "H")]).toEqual([false, false]);
  });
});

describe("Top prix avec indices supérieurs et dérogation", () => {
  const brands = [{ brand: "Kumho", tier: "entree", active: true }] as unknown as BrandTierRow[];
  const o = (p: Partial<TireOffer> & Record<string, unknown>) =>
    ({ id: String(Math.random()), brand: "Kumho", model: "M", size: "205/55R16", season: "ete", tier: "", active: true,
       load_index: "91", speed_index: "V", price_kind: "purchase_ht", availability: null, supplier_key: "x", source: "x",
       purchase_price_ht: 60, ...p }) as unknown as TireOffer;
  const req = { size: "205/55R16", load: "91", speed: "V" };

  it("un 94W moins cher gagne ; 88V et 91H été écartés", () => {
    const r = pickTopPriceOffers({ brands, settings: null, quantity: 4, season: "ete", required: req, offers: [
      o({ model: "88V", load_index: "88", purchase_price_ht: 30 }),
      o({ model: "91H", speed_index: "H", purchase_price_ht: 31 }),
      o({ model: "94W", load_index: "94", speed_index: "W", purchase_price_ht: 50 }),
      o({ model: "91V", purchase_price_ht: 60 }),
    ] });
    expect(r[0]!.model).toBe("94W");
    expect(r[0]!.compatibility).toBe("compatible");
  });

  it("4 saisons 3PMSF un cran en dessous : retenu avec avertissement", () => {
    const r = pickTopPriceOffers({ brands, settings: null, quantity: 4, season: "quatre_saisons", required: req, offers: [
      o({ season: "quatre_saisons", speed_index: "H", is3pmsf: true, purchase_price_ht: 40 }),
    ] });
    expect(r[0]!.available).toBe(true);
    expect(r[0]!.compatibility).toBe("a_confirmer");
    expect(r[0]!.compatibilityMessage).toMatch(/3PMSF.*autocollant/);
  });
});
