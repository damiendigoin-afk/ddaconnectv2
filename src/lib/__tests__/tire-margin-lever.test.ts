import { describe, expect, it } from "vitest";

import {
  adjustOfferMargin,
  adjustOffersMargin,
  clampMarginAdjustment,
  marginAdjustmentLabel,
  type SevenOffer,
} from "@/lib/tires";

/** Offre standard : achat 100 € HT, marge standard 10 € HT, montage 40,80 € TTC. */
const standard: SevenOffer = {
  slot: "entree_ete",
  kind: "gamme",
  title: "Entrée de gamme — Été",
  tier: "entree",
  season: "ete",
  available: true,
  unavailableReason: "",
  brand: "Sailun",
  model: "Atrezzo",
  size: "205/55R16",
  loadIndex: "91",
  speedIndex: "V",
  quantity: 2,
  unitSourceHt: 100,
  marginHt: 10,
  unitSellHt: 110,
  tiresHt: 220,
  tiresTtc: 264,
  mountLabel: "Montage, équilibrage, valve",
  mountTtc: 40.8,
  totalHt: 254,
  totalVat: 50.8,
  totalTtc: 304.8,
  availability: null,
  compatibility: "compatible",
  compatibilityMessage: "Compatible",
  supplier: "centralepneus",
  supplierRef: "x",
  consultedAt: null,
  offerId: null,
};

describe("levier de marge", () => {
  it("laisse la marge standard inchangée en position centrale", () => {
    expect(adjustOfferMargin(standard, 0)).toEqual(standard);
    expect(marginAdjustmentLabel(0)).toBe("Marge standard");
  });

  it("divise la marge par deux à −50 %", () => {
    const o = adjustOfferMargin(standard, -50);
    expect(o.marginHt).toBe(5);
    expect(o.unitSellHt).toBe(105);
    expect(o.tiresTtc).toBeCloseTo(252, 2);
    expect(marginAdjustmentLabel(-50)).toBe("Marge −50 %");
  });

  it("double la marge à +100 %", () => {
    const o = adjustOfferMargin(standard, 100);
    expect(o.marginHt).toBe(20);
    expect(o.unitSellHt).toBe(120);
    expect(o.totalTtc).toBeCloseTo(288 + 40.8, 2);
  });

  it("ne modifie jamais le montage", () => {
    for (const pct of [-50, -20, 0, 30, 100]) {
      expect(adjustOfferMargin(standard, pct).mountTtc).toBe(40.8);
    }
  });

  it("ne cumule pas les ajustements successifs", () => {
    const a = adjustOfferMargin(standard, 100);
    const b = adjustOfferMargin(standard, -50);
    const back = adjustOfferMargin(standard, 0);
    expect(a.marginHt).toBe(20);
    expect(b.marginHt).toBe(5);
    expect(back).toEqual(standard);
    // Repartir de l'offre standard, jamais d'une offre déjà ajustée.
    expect(adjustOfferMargin(standard, -50).marginHt).toBe(5);
  });

  it("borne la position du levier et gère les offres indisponibles", () => {
    expect(clampMarginAdjustment(999)).toBe(100);
    expect(clampMarginAdjustment(-999)).toBe(-50);
    const off = { ...standard, available: false, marginHt: null, unitSourceHt: null };
    expect(adjustOffersMargin([off], 100)[0]).toEqual(off);
  });
});
