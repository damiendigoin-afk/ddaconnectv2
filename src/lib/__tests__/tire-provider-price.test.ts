import { describe, expect, it } from "vitest";
import { extractItems } from "@/lib/tire-provider.server";
import { publicItemsToOffers, sevenOffersFor } from "@/lib/tires";

/** Fixture au format réel CentralePneus (dataLayer = prix HT, carte = prix TTC affiché). */
const card = (id: string, title: string, price: string, extra = "") =>
  `<div class="product-list-item" data-gtm-item-rank="1"><a data-gtm--select-item-identifier-param="${id}">${extra}${title}<div class="price__container"><div class="price "><div class="price__amount"><span class="price__amount--value">${price}</span><span class="price__amount--devise">€</span></div></div></div></a></div>`;
const dl = (items: unknown[]) =>
  `<script>dataLayer.push(${JSON.stringify({ event: "view_item_list", ecommerce: { items } })});</script>`;

const HTML =
  dl([
    { item_id: "tyre751078", item_name: "Hankook Kinergy 4S H740 145/70 R13 71T M+S 3PMSF", item_brand: "Hankook", item_category4: "G", price: 50.74 },
    { item_id: "tyre900001", item_name: "Tracmax A/S Trac Saver 145/70 R13 71T", item_brand: "Tracmax", item_category4: "G", price: 42.83 },
    { item_id: "tyre900002", item_name: "Imperial Ecodriver 4 145/70 R13 71T", item_brand: "Imperial", item_category4: "S", price: 36.99 },
  ]) +
  card("900002", "Imperial Ecodriver 4 145/70 R13 71T", "44,39") +
  card("751078", "Hankook Kinergy 4S H740 145/70 R13 71T M+S 3PMSF", "60,89") +
  card("900001", "Tracmax A/S Trac Saver 145/70 R13 71T", "51,40");

const settings = { margin_pct: 20, min_margin_ht: 10, tire_mount_price_ht: 17 } as never;

describe("CentralePneus : prix affiché rattaché au produit", () => {
  const items = extractItems(HTML, "u", "2026-10-13T00:00:00.000Z");
  const by = (b: string) => items.find((i) => i.brand === b)!;

  it("Hankook H740 145/70 R13 71T => 60,89 € TTC affiché, pas le prix HT du dataLayer", () => {
    expect(by("Hankook").publicPriceTtc).toBe(60.89);
  });

  it("chaque prix suit son produit malgré l'ordre différent des cartes", () => {
    expect(by("Tracmax").publicPriceTtc).toBe(51.4);
    expect(by("Imperial").publicPriceTtc).toBe(44.39);
  });

  it("chiffrage Hankook : 50,74 HT + marge 10,15 => total 186,94 € TTC pour 2 pneus", () => {
    const offers = publicItemsToOffers(items, [{ brand: "Hankook", tier: "milieu", active: true } as never]);
    const seven = sevenOffersFor({
      offers,
      quantity: 2,
      settings,
      required: { size: "145/70R13", load: "71", speed: "T" },
      brands: [{ brand: "Hankook", tier: "milieu", active: true } as never],
    } as never);
    const h = seven.find((o) => o.slot === "milieu_quatre_saisons")!;
    expect(h.unitPublicTtc).toBe(60.89);
    expect(h.unitSourceHt).toBeCloseTo(50.74, 2);
    expect(h.marginHt).toBeCloseTo(10.15, 2);
    expect(h.unitSellHt).toBeCloseTo(60.89, 2);
    expect(h.tiresTtc).toBeCloseTo(146.14, 2);
    expect(h.mountTtc).toBe(40.8);
    expect(h.totalTtc).toBeCloseTo(186.94, 2);
  });

  it("prix barré / prix d'un autre article dans la page ne contamine pas", () => {
    const html =
      dl([{ item_id: "tyre751078", item_name: "Hankook Kinergy 4S H740 145/70 R13 71T", item_brand: "Hankook", item_category4: "G", price: 50.74 }]) +
      `<div class="bon-plan"><span class="price__amount--value">39,90</span></div>` +
      card("751078", "Hankook Kinergy 4S H740 145/70 R13 71T", "60,89", `<s class="old-price"><span class="price__amount--old">72,00</span></s>`);
    expect(extractItems(html, "u", "x")[0]!.publicPriceTtc).toBe(60.89);
  });

  it("même modèle, indice ou dimension différents => pas de mélange", () => {
    const html =
      dl([{ item_id: "tyre751078", item_name: "Hankook Kinergy 4S H740 145/70 R13 71T", item_brand: "Hankook", item_category4: "G", price: 50.74 }]) +
      card("751078", "Hankook Kinergy 4S H740 155/70 R13 75T", "60,89");
    expect(extractItems(html, "u", "x")).toHaveLength(0);
  });

  it("aucun prix affiché pour ce produit => offre écartée, jamais de prix voisin", () => {
    const html =
      dl([
        { item_id: "tyre751078", item_name: "Hankook Kinergy 4S H740 145/70 R13 71T", item_brand: "Hankook", item_category4: "G", price: 50.74 },
        { item_id: "tyre900001", item_name: "Tracmax A/S Trac Saver 145/70 R13 71T", item_brand: "Tracmax", item_category4: "G", price: 42.83 },
      ]) + card("900001", "Tracmax A/S Trac Saver 145/70 R13 71T", "51,40");
    const items2 = extractItems(html, "u", "x");
    expect(items2.map((i) => i.brand)).toEqual(["Tracmax"]);
  });

  it("prix affiché incohérent avec le prix HT de la source => offre écartée", () => {
    const html =
      dl([{ item_id: "tyre751078", item_name: "Hankook Kinergy 4S H740 145/70 R13 71T", item_brand: "Hankook", item_category4: "G", price: 50.74 }]) +
      card("751078", "Hankook Kinergy 4S H740 145/70 R13 71T", "42,08");
    expect(extractItems(html, "u", "x")).toHaveLength(0);
  });
});
