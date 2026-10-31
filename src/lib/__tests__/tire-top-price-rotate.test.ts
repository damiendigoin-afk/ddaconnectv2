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
  offer({ brand: "Zzeta", purchase_price_ht: 22, tier: "milieu" }), // autre gamme
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

  it("Nankang : entrée (référentiel mondial, sources concordantes), quel que soit le paramétrage", () => {
    expect(tierOfOffer(brands, { brand: "Nankang", tier: "milieu" } as TireOffer)).toBe("entree");
    const set = [{ brand: "Nankang", tier: "haut", active: true }] as unknown as BrandTierRow[];
    expect(tierOfOffer(set, { brand: "NANKANG", tier: "milieu" } as TireOffer)).toBe("entree");
    expect(effectiveTier("Nankang", "milieu", {})).toBe("entree");
  });
});

import { unclassifiedBrands } from "@/lib/tire-top-price-source";

import { applyBrandReference, divergentSourceBrands, tierOfBrand } from "@/lib/tires";
import { brandReferenceOf, normalizeBrandKey } from "@/lib/tire-brand-reference";
import { districashOffersOf } from "@/lib/tire-top-price-core";

describe("Référentiel mondial des marques", () => {
  it("Nokian : milieu selon les sources (TheTyreLab upper-middle + CentralePneus quality), sources tracées", () => {
    const r = brandReferenceOf("NOKIAN")!;
    expect(r.tier).toBe("milieu");
    expect(r.status).toBe("concordant");
    expect(r.evidence.map((e) => e.source).sort()).toEqual(["centralepneus", "thetyrelab"]);
    expect(r.checkedOn).toBe("2026-10-31");
  });

  it("même marque = même gamme quel que soit le fournisseur ou la gamme qu'il déclare", () => {
    const cp = offer({ brand: "Hankook", purchase_price_ht: 70, tier: "milieu", supplier_key: "centralepneus" });
    const dc = offer({ brand: "HANKOOK", purchase_price_ht: 72, tier: "entree", supplier_key: "districash" });
    const loc = offer({ brand: "hankook ", purchase_price_ht: 74, tier: "", supplier_key: "catalogue_local" });
    expect([cp, dc, loc].map((o) => tierOfOffer(brands, o))).toEqual(["haut", "haut", "haut"]);
    const grid = pickTopPriceOffers({ offers: [cp, dc, loc], brands, settings: null, quantity: 4, season: "ete", required: req });
    expect(grid.map((g) => g.available)).toEqual([false, false, true]);
  });

  it("Districash : le référentiel prime sur la gamme du portail", () => {
    const res = { ok: true, error: "", consultedAt: "2026-10-31T00:00:00Z", rows: [{ code: "1", ean: "1", brand: "MICHELIN", label: "MICHELIN PRIMACY 4 205/55R16 91V", purchaseHt: 80, availability: "J", productUrl: null, supplierTier: "entree" }] };
    const conv = districashOffersOf(res as never, brands);
    expect(conv.offers.map((o) => o.tier)).toEqual(["haut"]);
  });

  it("le paramétrage garage ne peut pas déclasser une marque référencée (mode classique)", () => {
    const rows = [{ id: "1", brand: "Hankook", tier: "milieu", active: true, is_default: true, sort_order: 1 }] as unknown as BrandTierRow[];
    expect(tierOfBrand(rows, "Hankook")).toBe("haut");
    expect(applyBrandReference(rows)[0]).toMatchObject({ tier: "haut", is_default: false });
  });

  it("alias et variantes d'orthographe", () => {
    expect(normalizeBrandKey("Good Year")).toBe("GOODYEAR");
    expect(normalizeBrandKey("BF Goodrich")).toBe(normalizeBrandKey("BFGoodrich"));
    expect(brandReferenceOf("Michelin Tyres")?.tier).toBe("haut");
  });

  it("marque inconnue : gamme fournisseur provisoire ; divergente entre fournisseurs => exclue, jamais par prix", () => {
    const a = offer({ brand: "Zzinconnue", purchase_price_ht: 10, tier: "entree", supplier_key: "centralepneus" });
    expect(brandReferenceOf("Zzinconnue")).toBeNull();
    expect(tierOfOffer(brands, a)).toBe("entree");
    const b = offer({ brand: "ZZINCONNUE", purchase_price_ht: 11, tier: "haut", supplier_key: "districash" });
    expect(divergentSourceBrands(brands, [a, b])).toEqual(["ZZINCONNUE"]);
    const grid = pickTopPriceOffers({ offers: [a, b], brands, settings: null, quantity: 4, season: "ete", required: req });
    expect(grid.every((g) => !g.available)).toBe(true);
    expect(unclassifiedBrands([{ brand: "Zzsans", tier: "" }])).toEqual(["ZZSANS"]);
  });

  it("marque divergente dans le référentiel (Nexen) : aucune gamme globale, à vérifier", () => {
    expect(brandReferenceOf("Nexen")).toMatchObject({ tier: null, status: "divergent" });
  });
});

import { prevTopPriceAlternative } from "@/lib/tires";

describe("Rotation arrière (clic droit)", () => {
  it("précédente en boucle, y compris après rotations avant", () => {
    const a = alts(); // Dovroad, ARIVO, Kpatos
    expect(prevTopPriceAlternative(a, "Dovroad")!.brand).toBe("Kpatos");
    let cur = "Dovroad";
    cur = nextTopPriceAlternative(a, cur)!.brand; // ARIVO
    cur = nextTopPriceAlternative(a, cur)!.brand; // Kpatos
    cur = prevTopPriceAlternative(a, cur)!.brand;
    expect(cur).toBe("ARIVO");
    cur = prevTopPriceAlternative(a, cur)!.brand;
    expect(cur).toBe("Dovroad");
  });
  it("aucune précédente avec une seule marque", () => {
    expect(prevTopPriceAlternative(alts().slice(0, 1), "Dovroad")).toBeNull();
  });
  it("arrière ne modifie qu'une case, gamme/saison/titre conservés", () => {
    const grid = pickTopPriceOffers({ offers: pool, brands, settings: null, quantity: 4, season: "ete", required: req });
    const prev = prevTopPriceAlternative(alts(), grid[0]!.brand)!;
    const updated = grid.map((g, i) => (i === 0 ? topPriceSlotWith(g, prev, 4, null, req) : g));
    expect(updated[0]).toMatchObject({ brand: "Kpatos", unitSourceHt: 40, slot: "entree_ete", tier: "entree", season: "ete", title: grid[0]!.title });
    expect(updated[1]).toBe(grid[1]);
    expect(updated[2]).toBe(grid[2]);
  });
});

describe("Roadking (référentiel mondial)", () => {
  it("entrée, 3 sources concordantes datées", () => {
    const r = brandReferenceOf("ROAD KING")!;
    expect(r).toMatchObject({ tier: "entree", status: "concordant", checkedOn: "2026-10-31" });
    expect(r.evidence.map((e) => e.source).sort()).toEqual(["neomatic", "quelpneu", "tyrecomp"]);
  });
  it("entrée même si la source ne donne rien ou se contredit, et plus jamais non classée", () => {
    expect(tierOfOffer(brands, { brand: "Roadking", tier: "" } as unknown as TireOffer)).toBe("entree");
    expect(tierOfOffer(brands, { brand: "ROADKING", tier: "haut" } as TireOffer)).toBe("entree");
    expect(effectiveTier("Roadking", "milieu", {})).toBe("entree");
    expect(unclassifiedBrands([{ brand: "Roadking", tier: "" }])).toEqual([]);
    const a = offer({ brand: "Roadking", purchase_price_ht: 20, tier: "milieu", supplier_key: "centralepneus" });
    const b = offer({ brand: "ROADKING", purchase_price_ht: 21, tier: "haut", supplier_key: "districash" });
    expect(divergentSourceBrands(brands, [a, b])).toEqual([]);
    const [entree] = pickTopPriceOffers({ offers: [a, b], brands, settings: null, quantity: 4, season: "ete", required: req });
    expect(entree!.brand).toBe("Roadking");
  });
});
