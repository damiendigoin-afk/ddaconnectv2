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

import { districashPortalLink as dpl, DISTRICASH_PORTAL_URL } from "@/lib/tires";
describe("districashPortalLink", () => {
  it("ouvre seulement l'accueil du portail, sans jeton, avec la référence à copier", () => {
    const l = dpl({ available: true, supplier: "districash", supplierRef: "8808563527390" });
    expect(l).toEqual({ label: "Ouvrir Districash", url: "https://districashv2.inoshop.net/", reference: "8808563527390", direct: false });
    expect(DISTRICASH_PORTAL_URL).not.toMatch(/[?#]/);
  });
  it("aucun lien pour une offre indisponible ou d'un autre fournisseur", () => {
    expect(dpl({ available: false, supplier: "districash", supplierRef: "X" })).toBeNull();
    expect(dpl({ available: true, supplier: "centralepneus", supplierRef: "X" })).toBeNull();
  });
});

import { parseDistricashSearch, districashRowsToOffers, safeDistricashProductUrl } from "@/lib/districash";
const ROW = (href: string) => `<table><tr class="ARTICLE ARTICLE_CONTENT" data-filtremarques="HANKOOK" data-filtrelibelle="245/45R20 103V KINERGY 4S2" data-filtrecodearticle="2454520HK" data-filtreprixachat="208.00" data-ean="8808563527390" data-dispo-type="J+"><td><a href="${href}">2454520HK</a></td><td><a href="${href}">KINERGY</a></td></tr><tr class="ARTICLE ARTICLE_CONTENT" data-ean="8808563527390"><td>aux</td></tr></table>`;
describe("lien fiche Districash", () => {
  it("lit l'URL réelle de l'ancre (relative normalisée) et ignore la ligne secondaire", () => {
    const rows = parseDistricashSearch(ROW("/catalog/product/2055516HALPIN791/4808/STD"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.productUrl).toBe("https://districashv2.inoshop.net/catalog/product/2055516HALPIN791/4808/STD");
    const offer = districashRowsToOffers(rows, () => "premium", "2026-10-15T12:00:00Z")[0]!;
    expect(offer.product_url).toBe(rows[0]!.productUrl);
    expect(dpl({ available: true, supplier: "districash", supplierRef: "2454520HK", productUrl: offer.product_url }))
      .toMatchObject({ label: "Voir chez Districash", url: rows[0]!.productUrl, direct: true });
  });
  it("rejette les URL malveillantes ou sensibles", () => {
    for (const bad of ["javascript:alert(1)", "https://evil.com/catalog/product/X/1/STD", "http://districashv2.inoshop.net/catalog/product/X/1/STD",
      "https://districashv2.inoshop.net/catalog/product/X/1/STD?_token=abc", "https://districashv2.inoshop.net/cart/add", "https://u:p@districashv2.inoshop.net/catalog/product/X"])
      expect(safeDistricashProductUrl(bad)).toBeNull();
    expect(parseDistricashSearch(ROW("https://evil.com/catalog/product/X/1/STD"))[0]!.productUrl).toBeNull();
  });
  it("sans URL sûre : repli portail + référence", () => {
    expect(dpl({ available: true, supplier: "districash", supplierRef: "R1", productUrl: "javascript:x" }))
      .toMatchObject({ url: "https://districashv2.inoshop.net/", direct: false, reference: "R1" });
  });
});
