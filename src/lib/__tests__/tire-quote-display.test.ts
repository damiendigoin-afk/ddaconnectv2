import { describe, expect, it } from "vitest";
import { priceTireLine } from "@/lib/tires";
import { offerPriceLines } from "@/lib/tire-quote-display";
import type { SevenOffer } from "@/lib/tires";

function offerFrom(q: number, mountTtc: number | null): SevenOffer {
  const p = priceTireLine({ unitSourceHt: 61.27, marginHt: 18.38, quantity: q, mountTtc });
  return { quantity: q, unitSourceHt: 61.27, marginHt: 18.38, ...p } as unknown as SevenOffer;
}

describe("prix de vente unitaire HT par pneu", () => {
  it.each([1, 2, 4])("reste le même PU vente HT pour %i pneu(s), pose exclue", (q) => {
    const o = offerFrom(q, 20.4 * q);
    const pl = offerPriceLines(o);
    expect(pl.unitSellHt).toBe(79.65);
    expect(pl.tiresHt).toBe(Math.round(79.65 * q * 100) / 100);
    expect(pl.mountTtc).toBe(20.4 * q);
  });

  it("n'utilise jamais le prix d'achat HT", () => {
    const pl = offerPriceLines(offerFrom(4, 81.6));
    expect(pl.unitSellHt).not.toBe(61.27);
    expect(pl.tiresHt).toBe(318.6);
    expect(pl.totalTtc).toBe(Math.round((318.6 * 1.2 + 81.6) * 100) / 100);
  });

  it("le PU HT ne dépend pas du montage", () => {
    expect(offerPriceLines(offerFrom(2, null)).unitSellHt).toBe(offerPriceLines(offerFrom(2, 40.8)).unitSellHt);
  });
});
