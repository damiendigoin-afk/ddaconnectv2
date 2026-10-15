import { describe, expect, it } from "vitest";
import { districashRowsToOffers, parseDistricashSearch } from "../districash";
import { buildSevenOffers, type BrandTierRow } from "../tires";

const tr = (p: { code: string; brand: string; label: string; fam: string; pa: string; dispo: string; gamme?: string }) =>
  `<tr class="ARTICLE ARTICLE_CONTENT" data-ean="1${p.code}" data-dispo-type="${p.dispo}" data-filtrecodearticle="${p.code}" data-filtremarques="${p.brand}" data-filtrelibelle="${p.label}" data-filtresous-familles-lib="${p.fam}" data-filtreprixachat="${p.pa}"${p.gamme ? ` data-filtregamme="${p.gamme}"` : ""}><td>a</td><td><a href="/catalog/product/${p.code}/X/STD">x</a></td></tr>`;

const html = [
  tr({ code: "MI1", brand: "MICHELIN", label: "PRIMACY 4+ 205/55R16 91V", fam: "TOURISME ETE", pa: "110", dispo: "ag", gamme: "PREMIUM" }),
  tr({ code: "TA1", brand: "TAURUS", label: "ALL SEASON 205/55R16 91V", fam: "TOURISME TOUTES SAISONS", pa: "49.23", dispo: "grp", gamme: "BUDGET" }),
  tr({ code: "BF1", brand: "BFGOODRICH", label: "ADVANT AS 205/55R16 91V", fam: "TOURISME TOUTES SAISONS", pa: "63.30", dispo: "ag", gamme: "MEDIUM" }),
  tr({ code: "KO1", brand: "KORMORAN", label: "ROAD 205/55R16 91V", fam: "TOURISME ETE", pa: "40", dispo: "nonecmd", gamme: "BUDGET" }),
  tr({ code: "NX1", brand: "NOGAMME", label: "SUMMER X 205/55R16 91V", fam: "TOURISME ETE", pa: "30", dispo: "ag" }),
  tr({ code: "SA1", brand: "SAILUN", label: "ELITE SH32 205/55R16 91V", fam: "TOURISME ETE", pa: "45", dispo: "ag", gamme: "PREMIUM" }),
  tr({ code: "KL1", brand: "KLEBER", label: "DYNAXER HP5 205/55R16 91V", fam: "TOURISME ETE", pa: "70", dispo: "ag", gamme: "MEDIUM" }),
  tr({ code: "PZ1", brand: "PIRELLI", label: "CINTURATO P7 205/55R16 91V", fam: "TOURISME ETE", pa: "95", dispo: "ag", gamme: "PREMIUM" }),
].join("");

const brand = (b: string, tier: string, i: number) =>
  ({ id: b, brand: b, tier, active: true, is_default: i === 0, sort_order: i }) as unknown as BrandTierRow;
const brands = [brand("MICHELIN", "haut", 0), brand("CONTINENTAL", "haut", 1), brand("KLEBER", "milieu", 0), brand("SAILUN", "entree", 0)];

const run = () => {
  const rows = parseDistricashSearch(html);
  const tierOf = (b: string) => brands.find((r) => r.brand === b)?.tier ?? null;
  const offers = districashRowsToOffers(rows, tierOf, "2026-10-15T12:00:00Z") as never;
  const out = buildSevenOffers({
    offers, brands, settings: null, quantity: 2,
    mounted: { brand: null, model: null, size: null, season: null },
    required: { size: "205/55R16", load: "91", speed: "V" },
  });
  return Object.fromEntries(out.map((o) => [o.slot, o.available ? o.brand : null]));
};

describe("6 cases : préférence puis repli marque équivalente", () => {
  const s = run();
  it("marques préférées prioritaires", () => {
    expect(s.haut_ete).toBe("MICHELIN");
    expect(s.milieu_ete).toBe("KLEBER");
    expect(s.entree_ete).toBe("SAILUN"); // paramétrée en entrée malgré attribut PREMIUM
  });
  it("repli BUDGET/MEDIUM pour 4 saisons", () => {
    expect(s.entree_quatre_saisons).toBe("TAURUS");
    expect(s.milieu_quatre_saisons).toBe("BFGOODRICH");
  });
  it("case vide sans équivalent vérifié", () => expect(s.haut_quatre_saisons).toBeNull());
  it("Pirelli PREMIUM non paramétré ne remplace pas Michelin préféré", () => expect(s.haut_ete).not.toBe("PIRELLI"));
  it("indisponible et sans gamme jamais placés", () => {
    expect(Object.values(s)).not.toContain("KORMORAN");
    expect(Object.values(s)).not.toContain("NOGAMME");
  });
  it("repli quand la préférée manque", () => {
    const rows = parseDistricashSearch(html.replace(/<tr[^>]*MI1[\s\S]*?<\/tr>/, ""));
    const offers = districashRowsToOffers(rows, (b) => brands.find((r) => r.brand === b)?.tier ?? null, "2026-10-15T12:00:00Z") as never;
    const out = buildSevenOffers({ offers, brands, settings: null, quantity: 2, mounted: { brand: null, model: null, size: null, season: null }, required: { size: "205/55R16", load: "91", speed: "V" } });
    expect(out.find((o) => o.slot === "haut_ete")?.brand).toBe("PIRELLI");
  });
});
