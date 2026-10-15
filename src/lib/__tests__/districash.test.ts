import { describe, expect, it } from "vitest";
import { DISTRICASH_JPLUS_IMAGE, districashStatus, parseDistricashSearch, quotableDistricashRows } from "../districash";

const row = (attrs: string, cells: string) => `<tr class="ARTICLE ARTICLE_CONTENT" ${attrs}>${cells}</tr>`;
const html = [
  row('data-filtremarques="HANKOOK" data-filtrelibelle="KINERGY 4S2 X 245/45 R20" data-filtrecodearticle="H1" data-filtreprixachat="208.00" data-ean="8808563527390"',
    `<td>a</td><td><img src="/img/${DISTRICASH_JPLUS_IMAGE}"></td>`),
  `<tr class="ARTICLE ARTICLE_CONTENT"><td colspan="9">ligne auxiliaire</td></tr>`,
  row('data-filtremarques="X" data-filtrelibelle="rouge" data-filtrecodearticle="R1" data-filtreprixachat="50"', `<td>a</td><td><img src="rouge.png"></td>`),
  row('data-filtremarques="Y" data-filtrelibelle="inconnu" data-filtrecodearticle="U1" data-filtreprixachat="60"', `<td>a</td><td>?</td>`),
].join("");

describe("Districash", () => {
  it("lit les lignes principales et ignore les lignes à 1 td", () => {
    const rows = parseDistricashSearch(html);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ brand: "HANKOOK", ean: "8808563527390", purchaseHt: 208, availability: "J+" });
  });
  it("ne propose que les pneus J/J+ (exclut rouges et inconnus)", () => {
    expect(quotableDistricashRows(parseDistricashSearch(html)).map((r) => r.code)).toEqual(["H1"]);
  });
  it("n'annonce jamais connecté sans test réussi", () => {
    expect(districashStatus({ configured: false })).toBe("non_configure");
    expect(districashStatus({ configured: true, lastCheckOk: null })).toBe("configure");
    expect(districashStatus({ configured: true, lastCheckOk: false })).toBe("erreur");
  });
});

import { districashRowsToOffers, districashSeason, parseDistricashLabel } from "../districash";
import { sourceHtOf } from "../tires";
describe("offres Districash pour le devis", () => {
  const rows = [
    { brand: "Hankook", label: "KINERGY 4S2 X H750A 245/45R20 103V XL", code: "H1", ean: "8808563527390", purchaseHt: 208, availability: "J+" as const },
    { brand: "Michelin", label: "PILOT SPORT 5 245/45ZR20 103Y", code: "M1", ean: "1", purchaseHt: 250, availability: "indisponible" as const },
    { brand: "X", label: "FOO 245/45R20 103V", code: "X1", ean: "2", purchaseHt: 90, availability: "inconnu" as const },
  ];
  it("ne garde que J/J+ et prend data-filtreprixachat comme prix d'achat HT", () => {
    const o = districashRowsToOffers(rows, (b) => (b === "HANKOOK" ? "milieu" : null), "2026-10-15T12:00:00Z");
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ brand: "HANKOOK", size: "245/45R20", load_index: "103", speed_index: "V", season: "quatre_saisons", tier: "milieu", supplier_key: "districash" });
    expect(sourceHtOf(o[0] as never)).toBe(208);
  });
  it("saison jamais devinée", () => {
    expect(districashSeason("FOO 245/45R20")).toBeNull();
    expect(parseDistricashLabel("245/45 R20 103V").size).toBe("245/45R20");
  });
});
