import { describe, expect, it } from "vitest";
import { pickTopPriceOffers, publicItemsToTopPriceOffers, configuredTierMap, publicItemsToOffers, type BrandTierRow, type PublicTireItem } from "@/lib/tires";
import { extractItems } from "@/lib/tire-provider.server";
import { sourceTierOfCategory, topPriceCoverageComplete, topPricePageUrl, unclassifiedBrands } from "@/lib/tire-top-price-source";

const brands = [
  { brand: "Kumho", tier: "entree", active: true },
  { brand: "Hankook", tier: "milieu", active: true },
  { brand: "Michelin", tier: "haut", active: true },
  { brand: "Nexen", tier: "entree", active: false },
] as unknown as BrandTierRow[];

const item = (brand: string, ttc: number, sourceTier: PublicTireItem["sourceTier"], ref = brand): PublicTireItem => ({
  supplierRef: ref, brand, model: "M", size: "205/55R16", loadIndex: "91", speedIndex: "V", season: "ete", is3pmsf: false,
  publicPriceTtc: ttc, availability: null, sourceUrl: "u", consultedAt: "2026-10-31T00:00:00.000Z", sourceTier,
});
const req = { size: "205/55R16", load: "91", speed: "V" };

describe("Top prix toutes marques", () => {
  it("une marque absente de tire_brand_tiers avec gamme source fiable peut gagner", () => {
    const offers = publicItemsToTopPriceOffers(
      [item("Kumho", 60, "entree"), item("Linglong", 48, "entree"), item("Michelin", 130, "haut")],
      brands,
    );
    const r = pickTopPriceOffers({ offers, brands, settings: null, quantity: 4, season: "ete", required: req });
    expect(r[0]!.brand).toBe("Linglong");
    expect(r[0]!.unitSourceHt).toBe(40);
  });

  it("sans gamme fiable : exclue et signalée « non classée », jamais classée par prix", () => {
    const offers = publicItemsToTopPriceOffers([item("Inconnue", 20, null), item("Kumho", 60, "haut")], brands);
    const r = pickTopPriceOffers({ offers, brands, settings: null, quantity: 4, season: "ete", required: req });
    expect(r[0]!.brand).toBe("Kumho"); // paramétrage DDA prioritaire sur la gamme source
    expect(r.some((o) => o.brand === "Inconnue")).toBe(false);
    expect(unclassifiedBrands(offers)).toEqual(["INCONNUE"]);
  });

  it("marque paramétrée mais désactivée : la gamme source ne la réactive pas", () => {
    const offers = publicItemsToTopPriceOffers([item("Nexen", 30, "entree")], brands);
    expect(offers[0]!.tier).toBe("");
  });

  it("le mode manuel ignore la gamme source (inchangé)", () => {
    expect(publicItemsToOffers([item("Linglong", 48, "entree")], brands)[0]!.tier).toBe("");
  });

  it("gamme source CentralePneus lue depuis item_category5", () => {
    expect(sourceTierOfCategory("discount")).toBe("entree");
    expect(sourceTierOfCategory("quality")).toBe("milieu");
    expect(sourceTierOfCategory("premium")).toBe("haut");
    expect(sourceTierOfCategory("autre")).toBeNull();
    const html = `<script>dataLayer.push({"event":"view_item_list","ecommerce":{"items":[{"item_id":"tyre1","item_name":"LINGLONG GM 205/55 R16 91V","item_brand":"LINGLONG","item_category4":"S","item_category5":"discount","price":40}]}});</script>`;
    // sans carte affichée l'article est écarté : seule la lecture de catégorie est testée ici
    expect(extractItems(html, "u", "x")).toEqual([]);
  });

  it("requête sans liste de marques : saison + tri prix + pagination", () => {
    expect(topPricePageUrl("https://x/pneu-auto-205-55-16/", "S", 1)).toBe("https://x/pneu-auto-205-55-16/?seasons%5B%5D=S&sort=price");
    expect(topPricePageUrl("https://x/pneu-auto-205-55-16/", "G", 3)).toContain("&p=3");
    expect(topPricePageUrl("https://x/", "S", 1)).not.toContain("brands");
  });

  it("pagination arrêtée seulement quand chaque gamme a des offres conformes", () => {
    const cfg = configuredTierMap(brands);
    const base = [item("A", 1, "entree"), item("B", 1, "entree"), item("C", 1, "milieu"), item("D", 1, "milieu"), item("E", 1, "haut")];
    expect(topPriceCoverageComplete(base, cfg, "91", "V")).toBe(false);
    expect(topPriceCoverageComplete([...base, { ...item("F", 1, "haut"), loadIndex: "88" }], cfg, "91", "V")).toBe(false);
    expect(topPriceCoverageComplete([...base, item("F", 1, "haut")], cfg, "91", "V")).toBe(true);
  });
});
