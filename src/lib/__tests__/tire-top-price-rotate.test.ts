import { describe, expect, it } from "vitest";
import {
  nextTopPriceAlternative,
  pickTopPriceOffers,
  tierOfOffer,
  topPriceBrandAlternatives,
  topPriceSlotWith,
  type BrandTierRow,
  type TireOffer,
} from "@/lib/tires";
import { effectiveTier } from "@/lib/tire-top-price-source";

const brands = [{ brand: "Kumho", tier: "milieu", active: true }] as unknown as BrandTierRow[];
let n = 0;
const offer = (p: Partial<TireOffer> & { brand: string; purchase_price_ht: number }): TireOffer =>
  ({ id: `o${++n}`, model: "M", size: "205/55R16", season: "ete", tier: "entree", active: true, load_index: "91", speed_index: "V",
     price_kind: "purchase_ht", availability: null, supplier_key: "catalogue_local", source: "x", ...p }) as unknown as TireOffer;
const req = { size: "205/55 R16", load: "91", speed: "V" };

const pool = [
  offer({ brand: "Dovroad", purchase_price_ht: 30 }),
  offer({ brand: "Dovroad", purchase_price_ht: 31, model: "Autre" }),
  offer({ brand: "Arivo", purchase_price_ht: 35 }),
  offer({ brand: "ARIVO", purchase_price_ht: 33, model: "Moins cher" }),
  offer({ brand: "Kpatos", purchase_price_ht: 40 }),
  offer({ brand: "Linglong", purchase_price_ht: 25, load_index: "88" }), // charge insuffisante
  offer({ brand: "Hifly", purchase_price_ht: 20, season: "quatre_saisons" }), // autre saison
  offer({ brand: "Zeta", purchase_price_ht: 22, tier: "milieu" }), // autre gamme
  offer({ brand: "Kumho", purchase_price_ht: 18 }), // paramétrée milieu
];
const alts = () => topPriceBrandAlternatives({ offers: pool, brands, tier: "entree", season: "ete", required: req });

describe("Top prix — autre marque, même gamme", () => {
  it("une offre par marque (la moins chère conforme), triée par prix, même gamme/saison", () => {
    const a = alts();
    expect(a.map((o) => [o.brand, o.purchase_price_ht])).toEqual([["Dovroad", 30], ["ARIVO", 33], ["Kpatos", 40]]);
  });

  it("la première alternative est la proposition initiale du Top prix", () => {
    const [entree] = pickTopPriceOffers({ offers: pool, brands, settings: null, quantity: 4, season: "ete", required: req });
    expect(entree!.brand).toBe(alts()[0]!.brand);
  });

  it("cycle par marque puis retour à l'initiale", () => {
    const a = alts();
    expect(nextTopPriceAlternative(a, "Dovroad")!.brand).toBe("ARIVO");
    expect(nextTopPriceAlternative(a, "Arivo")!.brand).toBe("Kpatos");
    expect(nextTopPriceAlternative(a, "Kpatos")!.brand).toBe("Dovroad");
  });

  it("aucune alternative si une seule marque", () => {
    expect(nextTopPriceAlternative(alts().slice(0, 1), "Dovroad")).toBeNull();
  });

  it("remplace une seule case, autres inchangées, chiffrage moteur", () => {
    const grid = pickTopPriceOffers({ offers: pool, brands, settings: null, quantity: 4, season: "ete", required: req });
    const next = nextTopPriceAlternative(alts(), grid[0]!.brand)!;
    const updated = grid.map((g, i) => (i === 0 ? topPriceSlotWith(g, next, 4, null, req) : g));
    expect(updated[0]!.brand).toBe("ARIVO");
    expect(updated[0]!.unitSourceHt).toBe(33);
    expect(updated[0]!.slot).toBe("entree_ete");
    expect(updated[0]!.title).toBe(grid[0]!.title);
    expect(updated[1]).toBe(grid[1]);
    expect(updated[2]).toBe(grid[2]);
  });

  it("Nankang : entrée de gamme même si la source la publie milieu ; paramétrage DDA prioritaire", () => {
    expect(tierOfOffer(brands, { brand: "Nankang", tier: "milieu" } as TireOffer)).toBe("entree");
    expect(tierOfOffer(brands, { brand: "NANKANG", tier: "milieu" } as TireOffer)).toBe("entree");
    const set = [{ brand: "Nankang", tier: "haut", active: true }] as unknown as BrandTierRow[];
    expect(tierOfOffer(set, { brand: "Nankang", tier: "milieu" } as TireOffer)).toBe("haut");
    expect(effectiveTier("Nankang", "milieu", {})).toBe("entree");
    // les autres marques gardent la gamme source
    expect(tierOfOffer(brands, { brand: "Nexen", tier: "milieu" } as TireOffer)).toBe("milieu");
  });
});
