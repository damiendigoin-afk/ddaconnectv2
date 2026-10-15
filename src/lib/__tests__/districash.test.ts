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
