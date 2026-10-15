import { describe, expect, it } from "vitest";
import { districashExclusions, districashSeason } from "../districash";
import { buildSevenOffers } from "../tires";

describe("saison Districash", () => {
  it.each([
    ["PREMIUMCONTACT 7 205/55R16 91V", "ete"],
    ["PREMIUM CONTACT 7 205/55 R16 91V", "ete"],
    ["PRIMACY 4+ 205/55R16 91V", "ete"],
    ["DYNAXER HP5 205/55R16 91V", "ete"],
    ["ATREZZO ELITE SH32 205/55R16 91V", "ete"],
    ["ALLSEASONCONTACT 2 205/55R16 91V", "quatre_saisons"],
    ["CROSSCLIMATE 3 205/55R16 91V", "quatre_saisons"],
    ["ADVANTAGE AS 205/55R16 91V", "quatre_saisons"],
    ["ALPIN 7 205/55R16 91H", "hiver"],
  ])("%s => %s", (label, s) => expect(districashSeason(label)).toBe(s));
  it("modèle inconnu : jamais deviné", () => expect(districashSeason("ZORGLUB X 205/55R16 91V")).toBeNull());
});

describe("grille : saison inconnue jamais placée dans une case saisonnière", () => {
  it("case 4 saisons vide plutôt qu'un modèle sans saison", () => {
    const o = (id: string, season: string) => ({ id, active: true, brand: "Continental", model: id, size: "205/55R16",
      season, tier: "haut", purchase_price_ht: 80, price_kind: "purchase_ht", mount_price_ttc: 0, load_index: "91", speed_index: "V" });
    const res = buildSevenOffers({
      offers: [o("PC7", "ete"), o("INCONNU", "")] as never,
      brands: [{ brand: "Continental", tier: "haut", active: true, is_default: true, sort_order: 0 }] as never,
      packages: [], settings: null, quantity: 2,
      mounted: { brand: null, model: null, size: "205/55R16", season: null },
      required: { size: "205/55R16", load: "91", speed: "V" },
    });
    expect(res.find((r) => r.slot === "haut_ete")?.model).toBe("PC7");
    expect(res.find((r) => r.slot === "haut_quatre_saisons")?.available).toBe(false);
  });
});

it("exclusions comptées sans notion de stock", () => {
  const r = (availability: string, purchaseHt: number | null) => ({ brand: "", label: "", code: "", ean: null, purchaseHt, availability, productUrl: null }) as never;
  expect(districashExclusions([r("J+", 1), r("inconnu", 1), r("indisponible", 1), r("J", null)])).toEqual({ total: 4, unavailable: 1, unknown: 1, noPrice: 1 });
});
