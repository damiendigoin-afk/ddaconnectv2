import { describe, expect, it } from "vitest";
import { extractItems, providerUrlFor, parseSize } from "@/lib/tire-provider.server";
import { applyMargin, publicItemsToOffers, sourceHtOf, sizeConfidenceMessage } from "@/lib/tires";

const HTML = `<script>dataLayer.push({"event":"view_item_list","ecommerce":{"items":[
{"item_id":"tyre1","item_name":"Michelin Primacy 4 215/65 R16 98H","item_brand":"Michelin","item_category4":"S","price":52.99},
{"item_id":"tyre1","item_name":"Michelin Primacy 4 215/65 R16 98H","item_brand":"Michelin","item_category4":"S","price":52.99},
{"item_id":"tyre2","item_name":"Kleber Quadraxer 3 215/65 R16 98H","item_brand":"Kleber","item_category4":"G","price":80.00}]}});</script>`;

describe("provider public CentralePneus", () => {
  it("construit l'URL publique de la dimension", () => {
    expect(parseSize("215/65R16")).toEqual({ width: "215", ratio: "65", diameter: "16" });
    expect(providerUrlFor("215/65 R16")).toBe("https://www.centralepneus.fr/pneu-auto-215-65-16/");
    expect(providerUrlFor("inconnue")).toBeNull();
  });

  it("extrait et dédoublonne les offres publiques", () => {
    const items = extractItems(HTML, "u", "2026-01-01T00:00:00.000Z");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      brand: "Michelin",
      size: "215/65R16",
      loadIndex: "98",
      speedIndex: "H",
      season: "ete",
      publicPriceTtc: 52.99,
    });
    expect(items[1]!.season).toBe("quatre_saisons");
  });

  it("ramène le prix public TTC au HT avant marge (jamais de double TVA)", () => {
    const items = extractItems(HTML, "u", "2026-01-01T00:00:00.000Z");
    const offers = publicItemsToOffers(items, [
      { brand: "Michelin", tier: "haut", active: true } as never,
    ]);
    const ht = sourceHtOf(offers[0]!);
    expect(ht).toBeCloseTo(44.16, 2);
    const { sellHt, marginHt } = applyMargin(ht, { margin_pct: 10, min_margin_ht: 10 } as never);
    expect(marginHt).toBe(10); // minimum 10 € HT par pneu
    expect(sellHt).toBeCloseTo(54.16, 2);
    expect(Math.round(sellHt * 1.2 * 100) / 100).toBeCloseTo(64.99, 2);
    expect(offers[0]!.tier).toBe("haut");
  });

  it("distingue dimension inconnue et indice manquant", () => {
    expect(sizeConfidenceMessage({ size: null, load: null, speed: null })).toBe("Dimension à confirmer");
    expect(sizeConfidenceMessage({ size: "215/65R16", load: null, speed: "H" })).toBe(
      "Indice de charge à confirmer",
    );
    expect(sizeConfidenceMessage({ size: "215/65R16", load: "98", speed: "H" })).toBeNull();
  });
});
