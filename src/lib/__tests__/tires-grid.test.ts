import { describe, expect, it } from "vitest";

import {
  buildSevenOffers,
  checkCompatibility,
  gradeFromDepth,
  judgeTire,
  mountPriceFor,
  wearGrid,
} from "../tires";

const grid = wearGrid(null);

describe("grille d'usure pneumatique", () => {
  it("applique les seuils validés", () => {
    expect(gradeFromDepth(5, grid)).toBe("correct");
    expect(gradeFromDepth(4, grid)).toBe("a_prevoir");
    expect(gradeFromDepth(3, grid)).toBe("a_prevoir");
    expect(gradeFromDepth(2.5, grid)).toBe("rapide");
    expect(gradeFromDepth(1.6, grid)).toBe("imperatif");
    expect(gradeFromDepth(null, grid)).toBeNull();
  });

  it("ne laisse pas la sévérité atténuer un danger manifeste", () => {
    const j = judgeTire({ depth_mm: 6, bulges: true }, grid, "permissif");
    expect(j.grade).toBe("imperatif");
  });

  it("module uniquement les appréciations subjectives", () => {
    expect(judgeTire({ depth_mm: 6, cracks: true }, grid, "permissif").grade).toBe("correct");
    expect(judgeTire({ depth_mm: 6, cracks: true }, grid, "standard").grade).toBe("a_prevoir");
    expect(judgeTire({ depth_mm: 6, cracks: true }, grid, "severe").grade).toBe("a_prevoir");
  });
});

describe("compatibilité pneumatique", () => {
  it("exige dimension, charge et vitesse", () => {
    const base = { requiredSize: "205/55R16", requiredLoad: "91", requiredSpeed: "V" };
    expect(
      checkCompatibility({ ...base, offerSize: "205/55 R16", offerLoad: "91", offerSpeed: "V" }).status,
    ).toBe("compatible");
    expect(
      checkCompatibility({ ...base, offerSize: "205/55R16", offerLoad: "88", offerSpeed: "V" }).status,
    ).toBe("a_confirmer");
    expect(
      checkCompatibility({ ...base, offerSize: "225/45R17", offerLoad: "91", offerSpeed: "V" }).status,
    ).toBe("a_confirmer");
  });
});

/* --------- Formule de prix pneus : achat + marge + montage paramétré --------- */

const settings = {
  margin_pct: 0,
  min_margin_ht: 0,
  tire_mount_price_ht: 17,
} as unknown as Parameters<typeof buildSevenOffers>[0]["settings"];

const brandRows = [
  { tier: "entree", brand: "Sailun", active: true, is_default: true, sort_order: 1 },
  { tier: "milieu", brand: "Kleber", active: true, is_default: true, sort_order: 1 },
  { tier: "haut", brand: "Michelin", active: true, is_default: true, sort_order: 1 },
] as unknown as Parameters<typeof buildSevenOffers>[0]["brands"];

const tire = (id: string, brand: string, season: string, ttc: number) =>
  ({
    id,
    active: true,
    brand,
    model: `${brand} model`,
    size: "205/55R16",
    season,
    tier: "",
    load_index: "91",
    speed_index: "V",
    price_kind: "public_ttc",
    public_ttc: ttc,
    availability: null,
    supplier_key: "centralepneus",
    supplier_ref: id,
    consulted_at: null,
  }) as unknown as Parameters<typeof buildSevenOffers>[0]["offers"][number];

describe("prix pneus", () => {
  it("facture le montage paramétré, par pneu", () => {
    expect(mountPriceFor(settings, 1)?.totalHt).toBe(17);
    expect(mountPriceFor(settings, 2)?.totalHt).toBe(34);
    expect(mountPriceFor(settings, 4)?.totalHt).toBe(68);
    expect(mountPriceFor(settings, 2)?.label).toBe("Montage, équilibrage, valve");
    expect(mountPriceFor(null, 2)).toBeNull();
  });

  it("chiffre réellement chaque gamme avec son produit, saison inconnue à défaut", () => {
    const offers = [
      tire("s1", "Sailun", "ete", 60),
      tire("k1", "Kleber", "", 90),
      tire("m1", "Michelin", "quatre_saisons", 150),
    ];
    const out = buildSevenOffers({
      offers,
      brands: brandRows,
      settings,
      quantity: 2,
      mounted: { brand: null, model: null, size: "205/55R16", season: null },
      required: { size: "205/55R16", load: "91", speed: "V" },
    });
    const grid = out.slice(1);
    expect(grid).toHaveLength(6);
    const byBrand = grid.filter((o) => o.available).map((o) => o.brand);
    expect(byBrand).toContain("Sailun");
    expect(byBrand).toContain("Kleber");
    expect(byBrand).toContain("Michelin");
    // 2 × 60 € TTC de pneus + 2 × 17 € HT de montage (20,40 € TTC).
    const sailun = grid.find((o) => o.brand === "Sailun")!;
    expect(sailun.totalTtc).toBeCloseTo(60 * 2 + 34 * 1.2, 2);
    expect(sailun.mountTtc).toBeCloseTo(40.8, 2);
  });
});
