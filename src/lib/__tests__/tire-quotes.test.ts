import { describe, expect, it } from "vitest";

import { canonicalBrand, suggestBrands, TIRE_BRANDS } from "@/lib/tire-brands";
import { formFromReference, quoteOffers, sizeFromForm } from "@/lib/tire-quotes";
import type { SevenOffer } from "@/lib/tires";

const offer = (slot: string): SevenOffer => ({ slot, title: slot } as unknown as SevenOffer);

describe("devis pneus manuels", () => {
  it("compose la dimension à partir des trois champs", () => {
    expect(sizeFromForm({ width: "205", height: "55", diameter: "16" })).toBe("205/55R16");
    expect(sizeFromForm({ width: "20", height: "55", diameter: "16" })).toBeNull();
    expect(sizeFromForm({ width: "205", height: "", diameter: "16" })).toBeNull();
  });

  it("préremplit les champs depuis une lecture OCR", () => {
    const f = formFromReference({ size: "205/55 R16", load_index: "91", speed_index: "v", brand: "Michelin" });
    expect(f).toMatchObject({ width: "205", height: "55", diameter: "16", load: "91", speed: "V", brand: "Michelin" });
    expect(formFromReference({ size: "illisible" })).toEqual({});
  });

  it("affiche toujours les six gammes, la marque demandée en plus", () => {
    const grid = ["a", "b", "c", "d", "e", "f"].map(offer);
    expect(quoteOffers({ requested: null, grid })).toHaveLength(6);
    const seven = quoteOffers({ requested: offer("identique"), grid });
    expect(seven).toHaveLength(7);
    expect(seven[0]!.slot).toBe("identique");
  });

  it("propose des marques sans jamais imposer la saisie", () => {
    expect(TIRE_BRANDS.length).toBeGreaterThan(90);
    expect(suggestBrands("mich")).toContain("Michelin");
    expect(suggestBrands("")).toEqual([]);
    expect(canonicalBrand("michelin")).toBe("Michelin");
    expect(canonicalBrand("Marque locale")).toBe("Marque locale");
    expect(canonicalBrand("")).toBeNull();
  });
});
