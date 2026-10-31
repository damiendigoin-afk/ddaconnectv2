import { describe, expect, it } from "vitest";
import { pickTopPriceOffers, type BrandTierRow, type TireOffer } from "@/lib/tires";

const brands = [
  { brand: "ZzKumho", tier: "entree", active: true },
  { brand: "ZzHankook", tier: "milieu", active: true },
  { brand: "ZzMichelin", tier: "haut", active: true },
  { brand: "ZzContinental", tier: "haut", active: true },
] as unknown as BrandTierRow[];

let n = 0;
const offer = (p: Partial<TireOffer> & { brand: string; purchase_price_ht: number }): TireOffer =>
  ({ id: `o${++n}`, model: "M", size: "205/55R16", season: "ete", tier: "", active: true, load_index: "91", speed_index: "V",
     price_kind: "purchase_ht", availability: null, supplier_key: "catalogue_local", source: "x", ...p }) as unknown as TireOffer;

const req = { size: "205/55 R16", load: "91", speed: "V" };
const run = (offers: TireOffer[], season: "ete" | "quatre_saisons" = "ete") =>
  pickTopPriceOffers({ offers, brands, settings: null, quantity: 4, season, required: req });

describe("Top prix", () => {
  it("retient le moins cher par gamme, marque indifférente, fournisseurs mélangés", () => {
    const r = run([
      offer({ brand: "ZzMichelin", purchase_price_ht: 120, supplier_key: "districash" }),
      offer({ brand: "ZzContinental", purchase_price_ht: 110, supplier_key: "centralepneus", price_kind: "public_ttc" } as never), // 91,67 HT
      offer({ brand: "ZzKumho", purchase_price_ht: 50 }),
      offer({ brand: "ZzHankook", purchase_price_ht: 70, supplier_key: "districash" }),
    ]);
    expect(r.map((o) => o.brand)).toEqual(["ZzKumho", "ZzHankook", "ZzContinental"]);
    expect(r[2]!.unitSourceHt).toBe(91.67);
    expect(r[2]!.supplier).toBe("centralepneus");
    expect(r[0]!.slot).toBe("entree_ete");
  });

  it("n'utilise jamais le prix pour classer une marque : gamme du paramétrage", () => {
    const r = run([offer({ brand: "ZzMichelin", purchase_price_ht: 30 })]);
    expect(r[0]!.available).toBe(false);
    expect(r[2]!.brand).toBe("ZzMichelin");
  });

  it("écarte indisponibles, mauvaise saison, charge/vitesse insuffisantes", () => {
    const r = run([
      offer({ brand: "ZzKumho", purchase_price_ht: 40, availability: "Indisponible" }),
      offer({ brand: "ZzKumho", purchase_price_ht: 41, season: "quatre_saisons" }),
      offer({ brand: "ZzKumho", purchase_price_ht: 42, load_index: "88" }),
      offer({ brand: "ZzKumho", purchase_price_ht: 43, speed_index: "H" }),
      offer({ brand: "ZzKumho", purchase_price_ht: 60, model: "OK" }),
    ]);
    expect(r[0]!.model).toBe("OK");
  });

  it("égalité de prix : disponibilité la plus rapide d'abord", () => {
    const r = run([
      offer({ brand: "ZzHankook", purchase_price_ht: 70, availability: "Disponible J+", model: "Lent" }),
      offer({ brand: "ZzHankook", purchase_price_ht: 70, availability: "Disponible J", model: "Rapide" }),
    ]);
    expect(r[1]!.model).toBe("Rapide");
  });

  it("marge et montage inchangés : même formule que le devis", () => {
    const r = run([offer({ brand: "ZzKumho", purchase_price_ht: 50 })]);
    expect(r[0]!.unitSellHt).toBe(r[0]!.unitSourceHt! + r[0]!.marginHt!);
    expect(r[0]!.quantity).toBe(4);
  });
});
