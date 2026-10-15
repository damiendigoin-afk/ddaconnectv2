/** Lien interne « Commander chez le fournisseur » : fiche produit exacte seulement. */
import { describe, expect, it } from "vitest";

import { extractItems, productUrlFromCard } from "@/lib/tire-provider.server";
import { publicItemsToOffers, supplierProductLink, type SevenOffer } from "@/lib/tires";

const PRODUCT = "/pneu-auto/hankook/kinergy-4s2-x-h750a/245-45-r20-103v-1154310";
const card = (id: string, href: string | null) =>
  `<div class="product-list-item" data-gtm-item-rank="1"><a ${href ? `href="${href}"` : ""} data-gtm--select-item-identifier-param="${id}">Hankook Kinergy 4S2 X H750A 245/45 R20 103V<div class="price "><span class="price__amount--value">176,69</span></div></a></div>`;
const dl = `<script>dataLayer.push(${JSON.stringify({ event: "view_item_list", ecommerce: { items: [{ item_id: "tyre1154310", item_name: "Hankook Kinergy 4S2 X H750A 245/45 R20 103V", item_brand: "Hankook", item_category4: "G", price: 147.24 }] } })});</script>`;

const base = {
  available: true,
  supplier: "centralepneus",
  supplierRef: "tyre1154310",
  productUrl: `https://www.centralepneus.fr${PRODUCT}`,
} as Pick<SevenOffer, "available" | "supplier" | "supplierRef" | "productUrl">;

describe("lecture du lien fiche produit", () => {
  it("reprend le lien de la carte, sans paramètres", () => {
    expect(productUrlFromCard(card("1154310", `${PRODUCT}?adref=%2Fpneu-auto-245-45-20%2F`), "1154310")).toBe(
      `https://www.centralepneus.fr${PRODUCT}`,
    );
  });
  it("refuse le lien d'un autre produit ou une page de recherche", () => {
    expect(productUrlFromCard(card("1154310", "/pneu-auto/x/y/245-45-r20-103v-999999"), "1154310")).toBeNull();
    expect(productUrlFromCard(card("1154310", "/pneu-auto-245-45-20/"), "1154310")).toBeNull();
    expect(productUrlFromCard(card("1154310", null), "1154310")).toBeNull();
  });
  it("le lien suit l'offre jusqu'au chiffrage", () => {
    const items = extractItems(dl + card("1154310", PRODUCT), "u", "2026-10-15T00:00:00Z");
    expect(items[0]!.productUrl).toBe(`https://www.centralepneus.fr${PRODUCT}`);
    const offer = publicItemsToOffers(items, [])[0] as unknown as { product_url: string };
    expect(offer.product_url).toBe(`https://www.centralepneus.fr${PRODUCT}`);
  });
});

describe("bouton interne", () => {
  it("affiché pour une fiche produit fiable", () => {
    expect(supplierProductLink(base)).toEqual({ label: "CentralePneus", url: `https://www.centralepneus.fr${PRODUCT}` });
  });
  it("masqué sans lien, offre indisponible, autre site ou autre produit", () => {
    expect(supplierProductLink({ ...base, productUrl: null })).toBeNull();
    expect(supplierProductLink({ ...base, available: false })).toBeNull();
    expect(supplierProductLink({ ...base, productUrl: `https://evil.example${PRODUCT}` })).toBeNull();
    expect(supplierProductLink({ ...base, productUrl: `http://www.centralepneus.fr${PRODUCT}` })).toBeNull();
    expect(supplierProductLink({ ...base, supplierRef: "tyre42" })).toBeNull();
    expect(supplierProductLink({ ...base, productUrl: "https://www.centralepneus.fr/pneu-auto-245-45-20/" })).toBeNull();
    expect(supplierProductLink({ ...base, supplier: "catalogue_local" })).toBeNull();
  });
});
