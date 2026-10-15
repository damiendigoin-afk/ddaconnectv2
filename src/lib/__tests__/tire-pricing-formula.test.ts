/**
 * Non-régression du calcul des devis pneus (règle unique : priceTireLine).
 * Base HT = prix public CentralePneus TTC / 1,20 ; marge = MAX(base × %, minimum HT)
 * (taux de MARGE, pas taux de marque) ; TVA 20 % ; montage = prix HT paramétré × quantité.
 */
import { describe, expect, it } from "vitest";

import { adjustOfferMargin, applyMargin, buildSevenOffers, priceTireLine, sourceHtOf } from "../tires";

type Settings = Parameters<typeof buildSevenOffers>[0]["settings"];
const settingsOf = (margin_pct: number, min_margin_ht: number, tire_mount_price_ht = 17) =>
  ({ margin_pct, min_margin_ht, tire_mount_price_ht }) as unknown as Settings;

const brands = [
  { tier: "entree", brand: "Sailun", active: true, is_default: true, sort_order: 1 },
  { tier: "milieu", brand: "Hankook", active: true, is_default: true, sort_order: 1 },
  { tier: "haut", brand: "Michelin", active: true, is_default: true, sort_order: 1 },
] as unknown as Parameters<typeof buildSevenOffers>[0]["brands"];

/** Offre CentralePneus : prix public TTC affiché sur la fiche produit. */
const hankook = (publicTtc: number) =>
  ({
    id: "centralepneus:tyre1154310",
    active: true,
    brand: "Hankook",
    model: "Kinergy 4S2 X H750A",
    size: "245/45R20",
    season: "quatre_saisons",
    tier: "",
    load_index: "103",
    speed_index: "V",
    price_kind: "public_ttc",
    purchase_price_ht: publicTtc,
    availability: null,
    supplier_key: "centralepneus",
    supplier_ref: "tyre1154310",
    price_date: "2026-10-15",
  }) as unknown as Parameters<typeof buildSevenOffers>[0]["offers"][number];

function quoteHankook(publicTtc: number, quantity: number, settings: Settings) {
  const out = buildSevenOffers({
    offers: [hankook(publicTtc)],
    brands,
    settings,
    quantity,
    mounted: { brand: null, model: null, size: "245/45R20", season: null },
    required: { size: "245/45R20", load: "103", speed: "V" },
  });
  const o = out.find((x) => x.slot === "milieu_quatre_saisons")!;
  expect(o.available).toBe(true);
  return o;
}

describe("marge pneus : taux de marge sur la base HT", () => {
  it("20 % sur 100 € HT donne 120 € HT (et non 125 € comme un taux de marque)", () => {
    expect(applyMargin(100, settingsOf(20, 10)).sellHt).toBe(120);
  });

  it("applique le minimum HT quand le pourcentage rapporte moins", () => {
    // 20 % de 40 € = 8 € < 10 € minimum.
    expect(applyMargin(40, settingsOf(20, 10))).toMatchObject({ marginHt: 10, sellHt: 50 });
  });

  it("applique le pourcentage quand il dépasse le minimum", () => {
    expect(applyMargin(147.24, settingsOf(20, 10))).toMatchObject({ marginHt: 29.45, sellHt: 176.69 });
    expect(applyMargin(100, settingsOf(30, 10))).toMatchObject({ marginHt: 30, sellHt: 130 });
  });

  it("marge nulle uniquement si le paramétrage est à 0 % et 0 €", () => {
    expect(applyMargin(100, settingsOf(0, 0)).sellHt).toBe(100);
    expect(applyMargin(100, settingsOf(0, 15)).sellHt).toBe(115);
  });
});

describe("base HT CentralePneus", () => {
  it("ramène le prix public TTC au HT avant la marge", () => {
    expect(sourceHtOf({ purchase_price_ht: 176.69, price_kind: "public_ttc" } as never)).toBe(147.24);
  });
  it("garde tel quel un vrai prix d'achat HT", () => {
    expect(sourceHtOf({ purchase_price_ht: 80, price_kind: "purchase_ht" } as never)).toBe(80);
  });
});

describe("devis Hankook 4 saisons 245/45 R20 (dernier devis réel, 15/10/2026)", () => {
  const s = settingsOf(20, 10, 17);

  it("2 pneus : valeurs identiques au devis enregistré", () => {
    const o = quoteHankook(176.69, 2, s);
    expect(o.unitSourceHt).toBe(147.24);
    expect(o.marginHt).toBe(29.45);
    expect(o.unitSellHt).toBe(176.69);
    expect(o.tiresHt).toBe(353.38);
    expect(o.tiresTtc).toBe(424.06);
    expect(o.mountTtc).toBe(40.8);
    expect(o.totalTtc).toBe(464.86);
    expect(o.totalHt).toBe(387.38);
    expect(o.totalVat).toBe(77.48);
  });

  it("1 pneu", () => {
    const o = quoteHankook(176.69, 1, s);
    expect(o.tiresTtc).toBe(212.03);
    expect(o.mountTtc).toBe(20.4);
    expect(o.totalTtc).toBe(232.43);
  });

  it("4 pneus", () => {
    const o = quoteHankook(176.69, 4, s);
    expect(o.tiresHt).toBe(706.76);
    expect(o.tiresTtc).toBe(848.11);
    expect(o.mountTtc).toBe(81.6);
    expect(o.totalTtc).toBe(929.71);
  });

  it("le prix client TTC par pneu dépasse toujours le prix public de la source", () => {
    for (const q of [1, 2, 4]) {
      const o = quoteHankook(176.69, q, s);
      expect((o.tiresTtc ?? 0) / q).toBeGreaterThan(176.69);
    }
  });
});

describe("petit pneu : le minimum de 10 € HT s'applique (cas 145/70 R13)", () => {
  it("60,89 € TTC public → 50,74 € HT + 10 € = 60,74 € HT par pneu", () => {
    const o = quoteHankook(60.89, 2, settingsOf(20, 10, 17));
    expect(o.unitSourceHt).toBe(50.74);
    expect(o.marginHt).toBe(10);
    expect(o.unitSellHt).toBe(60.74);
    expect(o.tiresTtc).toBe(145.78);
    expect(o.totalTtc).toBe(186.58);
  });
});

describe("montage paramétré", () => {
  it("20 € TTC par pneu si le réglage est 16,67 € HT", () => {
    const o = quoteHankook(176.69, 4, settingsOf(20, 10, 16.67));
    expect(o.mountTtc).toBe(80);
  });
  it("aucun montage si le réglage est vide", () => {
    const o = quoteHankook(176.69, 2, settingsOf(20, 10, 0));
    expect(o.mountTtc).toBeNull();
    expect(o.totalTtc).toBe(o.tiresTtc);
  });
});

describe("priceTireLine = calcul unique écran / levier / PDF", () => {
  it("le levier de marge passe par le même calcul", () => {
    const o = quoteHankook(176.69, 2, settingsOf(20, 10, 17));
    const adj = adjustOfferMargin(o, 50);
    const direct = priceTireLine({ unitSourceHt: 147.24, marginHt: 44.18, quantity: 2, mountTtc: 40.8 });
    expect(adj.marginHt).toBe(44.18);
    expect(adj).toMatchObject(direct);
  });
});
