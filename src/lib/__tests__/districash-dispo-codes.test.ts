import { describe, expect, it } from "vitest";
import { districashRowSeason, parseDistricashSearch, quotableDistricashRows } from "../districash";

const row = (code: string, dispo: string, fam: string, label: string, img = "vert.png") =>
  `<tr id="form-achat-${code}" class="ARTICLE ARTICLE_CONTENT" data-prix="50" data-ean="1234567890123" data-dispo-type="${dispo}" data-Filtrecodearticle="${code}" data-Filtremarques="X" data-Filtrelibelle="${label}" data-Filtresous-familles-lib="${fam}" data-filtreprixachat="50.00"><td><img class="icone-dispo-${code}" src="https://districashv2.inoshop.net/storage/distributeur/1/stock/${img}"></td><td>x</td></tr>`;

describe("codes de disponibilité Districash (légende portail)", () => {
  const html = [
    row("A", "ag", "TOURISME ETE", "PN KLE 205/55R16 91V DYN HP5 DT1"),
    row("B", "grp", "TOURISME TOUTES SAIS", "PN MIC 205/55R16 91H CCLIM 3", "H0kz82D2C3jk4sZV6zzvPWCWa8xHYoa7J9xixKPQ.png"),
    row("C", "nonecmd", "TOURISME ETE", "PN Z", "rouge.png"),
    row("D", "noref", "TOURISME ETE", "PN Z", "gris.png"),
    row("E", "agpart", "TOURISME ETE", "PN Z", "orange.png"),
    row("F", "agvirt", "TOURISME ETE", "PN Z", "transport.png"),
  ].join("");
  const rows = parseDistricashSearch(html);

  it("« ag » (vert, en agence) = J, « grp » = J+", () => {
    expect(rows.map((r) => r.availability)).toEqual(["J", "J+", "indisponible", "indisponible", "inconnu", "inconnu"]);
  });
  it("seuls J/J+ sont proposables (rouge, gris, orange, manufacturier exclus)", () => {
    expect(quotableDistricashRows(rows).map((r) => r.code)).toEqual(["A", "B"]);
  });
  it("saison lue sur la sous-famille portail, libellé abrégé reconnu", () => {
    expect(districashRowSeason(rows[0]!)).toBe("ete");
    expect(districashRowSeason(rows[1]!)).toBe("quatre_saisons");
    expect(districashRowSeason({ label: "PN BFG 205/55R16 91V ADVANT AS", family: "TOURISME TOUTES SAIS" })).toBe("quatre_saisons");
    expect(districashRowSeason({ label: "PN X 205/55R16 91V MODELEINCONNU", family: null })).toBeNull();
  });
});
