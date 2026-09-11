import { describe, expect, it } from "vitest";

import { brandsToRefetch, extractItems } from "@/lib/tire-provider.server";
import type { PublicTireItem as ServerItem } from "@/lib/tire-provider.server";
import {
  buildSevenOffers,
  offerMeetsRequirement,
  publicItemsToOffers,
  type PublicTireItem,
} from "@/lib/tires";

/* ------------------------- 1. Consultation par saison ---------------------- */

const item = (p: Partial<ServerItem> & { supplierRef: string; brand: string }): ServerItem => ({
  model: "M",
  size: "205/55R16",
  loadIndex: "91",
  speedIndex: "V",
  season: "ete",
  is3pmsf: false,
  publicPriceTtc: 60,
  availability: null,
  sourceUrl: "u",
  consultedAt: "2026-09-11T00:00:00.000Z",
  ...p,
});

const FILTERS = new Map([
  ["michelin", "4"],
  ["sailun", "225"],
  ["kleber", "12"],
]);

describe("consultation fournisseur par marque et par saison", () => {
  it("relance la consultation quand la marque n'est présente qu'en été", () => {
    const items = [item({ supplierRef: "a", brand: "Michelin", season: "ete" })];
    expect(brandsToRefetch(items, ["michelin"], FILTERS)).toEqual([{ brand: "michelin", id: "4" }]);
  });

  it("relance la consultation quand la marque n'est présente qu'en 4 saisons", () => {
    const items = [item({ supplierRef: "a", brand: "Michelin", season: "quatre_saisons" })];
    expect(brandsToRefetch(items, ["michelin"], FILTERS)).toEqual([{ brand: "michelin", id: "4" }]);
  });

  it("ne relance rien quand les deux saisons sont déjà présentes", () => {
    const items = [
      item({ supplierRef: "a", brand: "Michelin", season: "ete" }),
      item({ supplierRef: "b", brand: "Michelin", season: "quatre_saisons" }),
    ];
    expect(brandsToRefetch(items, ["michelin"], FILTERS)).toEqual([]);
  });

  it("ne cible que les marques nécessaires et connues du fournisseur", () => {
    expect(brandsToRefetch([], ["marque-inconnue"], FILTERS)).toEqual([]);
  });

  it("lit le marquage 3PMSF dans le libellé fournisseur", () => {
    const html = `<script>dataLayer.push({"event":"view_item_list","ecommerce":{"items":[
{"item_id":"t1","item_name":"Michelin CrossClimate 3 205/55 R16 91V 3PMSF","item_brand":"Michelin","item_category4":"G","price":79.82},
{"item_id":"t2","item_name":"Sailun Atrezzo 4Seasons 205/55 R16 94V XL","item_brand":"Sailun","item_category4":"G","price":49.49}]}});</script>`;
    const items = extractItems(html, "u", "2026-09-11T00:00:00.000Z");
    expect(items[0]!.is3pmsf).toBe(true);
    expect(items[1]!.is3pmsf).toBe(false);
  });
});

/* --------------------------- 2. Règles de conformité ----------------------- */

const req = { requiredLoad: "91", requiredSpeed: "V" };

describe("conformité charge / vitesse", () => {
  it("rejette une charge inférieure", () => {
    expect(
      offerMeetsRequirement({ offerLoad: "89", offerSpeed: "V", season: "ete", ...req }),
    ).toBe(false);
  });

  it("accepte une charge supérieure", () => {
    expect(
      offerMeetsRequirement({ offerLoad: "94", offerSpeed: "V", season: "ete", ...req }),
    ).toBe(true);
  });

  it("gère un indice de charge multiple", () => {
    expect(
      offerMeetsRequirement({ offerLoad: "91/89", offerSpeed: "V", season: "ete", ...req }),
    ).toBe(true);
  });

  it("rejette une vitesse inférieure en été", () => {
    expect(
      offerMeetsRequirement({ offerLoad: "91", offerSpeed: "H", season: "ete", ...req }),
    ).toBe(false);
  });

  it("rejette une vitesse inférieure en été même avec 3PMSF", () => {
    expect(
      offerMeetsRequirement({ offerLoad: "91", offerSpeed: "H", season: "ete", is3pmsf: true, ...req }),
    ).toBe(false);
  });

  it("accepte une vitesse égale ou supérieure en 4 saisons", () => {
    expect(
      offerMeetsRequirement({ offerLoad: "91", offerSpeed: "V", season: "quatre_saisons", ...req }),
    ).toBe(true);
    expect(
      offerMeetsRequirement({ offerLoad: "91", offerSpeed: "W", season: "quatre_saisons", ...req }),
    ).toBe(true);
  });

  it("accepte un cran de vitesse en moins en 4 saisons si 3PMSF", () => {
    expect(
      offerMeetsRequirement({
        offerLoad: "91",
        offerSpeed: "H",
        season: "quatre_saisons",
        is3pmsf: true,
        ...req,
      }),
    ).toBe(true);
  });

  it("rejette un cran de vitesse en moins en 4 saisons sans 3PMSF", () => {
    expect(
      offerMeetsRequirement({ offerLoad: "91", offerSpeed: "H", season: "quatre_saisons", ...req }),
    ).toBe(false);
  });

  it("rejette plus d'un cran en moins même avec 3PMSF", () => {
    expect(
      offerMeetsRequirement({
        offerLoad: "91",
        offerSpeed: "T",
        season: "quatre_saisons",
        is3pmsf: true,
        ...req,
      }),
    ).toBe(false);
  });

  it("la dérogation 3PMSF n'autorise jamais une charge inférieure", () => {
    expect(
      offerMeetsRequirement({
        offerLoad: "87",
        offerSpeed: "H",
        season: "quatre_saisons",
        is3pmsf: true,
        ...req,
      }),
    ).toBe(false);
  });
});

/* ------------------------- 3. Sélection du moins cher ---------------------- */

const brands = [
  { brand: "Sailun", tier: "entree", active: true, is_default: true, sort_order: 0 },
  { brand: "Kleber", tier: "milieu", active: true, is_default: true, sort_order: 0 },
  { brand: "Michelin", tier: "haut", active: true, is_default: true, sort_order: 0 },
] as never[];

const settings = { margin_pct: 20, min_margin_ht: 10, tire_mount_price_ht: 17 } as never;

const pub = (p: Partial<PublicTireItem> & { supplierRef: string; brand: string }): PublicTireItem => ({
  model: "M",
  size: "205/55R16",
  loadIndex: "91",
  speedIndex: "V",
  season: "ete",
  is3pmsf: false,
  publicPriceTtc: 60,
  availability: null,
  sourceUrl: "u",
  consultedAt: "2026-09-11T00:00:00.000Z",
  ...p,
});

function grid(items: PublicTireItem[]) {
  const offers = buildSevenOffers({
    offers: publicItemsToOffers(items, brands),
    brands,
    settings,
    quantity: 2,
    mounted: { brand: null, model: null, size: "205/55R16", season: null },
    required: { size: "205/55R16", load: "91", speed: "V" },
  });
  return new Map(offers.map((o) => [o.slot, o]));
}

describe("choix du produit conforme le moins cher", () => {
  it("écarte le 91H moins cher au profit d'un 91V conforme (été)", () => {
    const g = grid([
      pub({ supplierRef: "s1", brand: "Sailun", model: "Atrezzo Elite", speedIndex: "H", publicPriceTtc: 42.16 }),
      pub({ supplierRef: "s2", brand: "Sailun", model: "Atrezzo Elite 91V", speedIndex: "V", publicPriceTtc: 45.57 }),
      pub({ supplierRef: "s3", brand: "Sailun", model: "Atrezzo Elite 2", speedIndex: "V", publicPriceTtc: 48.99 }),
    ]);
    const o = g.get("entree_ete")!;
    expect(o.available).toBe(true);
    expect(o.speedIndex).toBe("V");
    expect(o.supplierRef).toBe("s2");
    expect(o.compatibility).toBe("compatible");
  });

  it("retient un Michelin été conforme dès qu'il est consulté", () => {
    const g = grid([
      pub({ supplierRef: "m1", brand: "Michelin", model: "CrossClimate 2", season: "quatre_saisons", loadIndex: "94", is3pmsf: true, publicPriceTtc: 102.49 }),
      pub({ supplierRef: "m2", brand: "Michelin", model: "Primacy 4+", publicPriceTtc: 66.49 }),
      pub({ supplierRef: "m3", brand: "Michelin", model: "Primacy 5", publicPriceTtc: 71.91 }),
    ]);
    expect(g.get("haut_ete")!.supplierRef).toBe("m2");
    expect(g.get("haut_quatre_saisons")!.supplierRef).toBe("m1");
  });

  it("Kleber 4 saisons : le 91H n'est retenu que s'il est 3PMSF", () => {
    const conforme = grid([
      pub({ supplierRef: "k1", brand: "Kleber", model: "Quadraxer 3", season: "quatre_saisons", speedIndex: "H", is3pmsf: true, publicPriceTtc: 60 }),
      pub({ supplierRef: "k2", brand: "Kleber", model: "Quadraxer 3", season: "quatre_saisons", publicPriceTtc: 66.49 }),
    ]);
    expect(conforme.get("milieu_quatre_saisons")!.supplierRef).toBe("k1");

    const sansMarquage = grid([
      pub({ supplierRef: "k1", brand: "Kleber", model: "Quadraxer 3", season: "quatre_saisons", speedIndex: "H", publicPriceTtc: 60 }),
      pub({ supplierRef: "k2", brand: "Kleber", model: "Quadraxer 3", season: "quatre_saisons", publicPriceTtc: 66.49 }),
    ]);
    expect(sansMarquage.get("milieu_quatre_saisons")!.supplierRef).toBe("k2");
  });

  it("une marque réellement absente d'une saison reste indisponible", () => {
    const g = grid([pub({ supplierRef: "m2", brand: "Michelin", model: "Primacy 4+" })]);
    const o = g.get("haut_quatre_saisons")!;
    expect(o.available).toBe(false);
    expect(o.unavailableReason).toContain("Michelin");
  });

  it("non-régression prix : marge et montage inchangés", () => {
    const o = grid([pub({ supplierRef: "s2", brand: "Sailun", publicPriceTtc: 60 })]).get("entree_ete")!;
    // 60 TTC → 50 HT, marge 20 % = 10 € (plancher), vente 60 HT
    expect(o.unitSourceHt).toBeCloseTo(50, 2);
    expect(o.marginHt).toBeCloseTo(10, 2);
    expect(o.unitSellHt).toBeCloseTo(60, 2);
    expect(o.tiresTtc).toBeCloseTo(144, 2);
    expect(o.mountTtc).toBeCloseTo(40.8, 2); // 17 € HT × 2
    expect(o.totalTtc).toBeCloseTo(184.8, 2);
  });
});
