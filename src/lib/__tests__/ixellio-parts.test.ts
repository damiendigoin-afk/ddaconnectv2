import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseAmount, parseIxellioParts, safeDetailLink } from "@/lib/ixellio-parts-parse";
import { buildPartsSearchBody, extractPartsCsrf, partsFormFieldNames } from "@/lib/ixellio-parts.server";

/** Fixture SYNTHÉTIQUE (structure réelle IXELLIO non encore relevée). */
const NO_BASIS = `<table><tr><th>Référence</th><th>Désignation</th><th>Marque</th><th>Prix</th><th></th></tr>
<tr><td>214992066R</td><td>DURITE</td><td>RENAULT</td><td>119,25 €</td><td><a href="/PieceDetail.html?method=view&id=1&token=x">Fiche</a></td></tr>
<tr><td>214992066R</td><td>DURITE SUP</td><td>RENAULT</td><td>119,25 €</td><td><a href="https://evil.com/x.html">x</a></td></tr>
<tr><td>8200000000</td><td>AUTRE</td><td></td><td>119,25 €</td></tr></table>`;

describe("parseIxellioParts", () => {
  it("lit 3 lignes à 119,25 sans inventer HT/TTC ni prix public", () => {
    const r = parseIxellioParts(NO_BASIS, "214992066R");
    expect(r.parts).toHaveLength(3);
    expect(r.parts[0]!.prices[0]).toMatchObject({ amount: 119.25, currency: "EUR", basis: "unknown", isPublic: null });
    expect(r.parts[0]!.exactMatch).toBe(true);
    expect(r.parts[2]!.exactMatch).toBe(false);
    expect(r.parts[2]!.brand).toBeNull();
    expect(r.parts[2]!.family).toBeNull();
  });
  it("HT / TTC / public seulement si l'en-tête le dit", () => {
    const html = `<table><tr><th>Réf.</th><th>Prix public TTC</th><th>Prix net HT</th></tr><tr><td>214996296R</td><td>26,44 €</td><td>20,00</td></tr></table>`;
    const p = parseIxellioParts(html, "214996296R").parts[0]!;
    expect(p.prices[0]).toMatchObject({ amount: 26.44, basis: "TTC", isPublic: true });
    expect(p.prices[1]).toMatchObject({ amount: 20, basis: "HT", isPublic: false, currency: null });
  });
  it("liens de fiche : domaine IXELLIO seulement, paramètres retirés", () => {
    const r = parseIxellioParts(NO_BASIS, "214992066R");
    expect(r.parts[0]!.detailLinks).toEqual(["/PieceDetail.html?method=view"]);
    expect(r.parts[1]!.detailLinks).toEqual([]);
    expect(safeDetailLink("javascript:alert(1)")).toBeNull();
  });
  it("détecte la page de login et l'absence de résultat", () => {
    expect(parseIxellioParts('<input name="j_username">', "X").isLoginPage).toBe(true);
    expect(parseIxellioParts("<p>Aucun résultat</p>", "X").noResult).toBe(true);
  });
  it("montants", () => {
    expect(parseAmount("1 234,50 €")).toEqual({ amount: 1234.5, currency: "EUR" });
    expect(parseAmount("—")).toBeNull();
  });
});

describe("requête searchReference", () => {
  const PAGE = `<form action="/PieceRecherche.html?method=searchReference" method="post"><input type="hidden" name="_csrf" value="TK"/><input name="reference"/></form>`;
  it("CSRF, champs (noms seuls) et corps urlencoded `reference`", () => {
    expect(extractPartsCsrf(PAGE)).toBe("TK");
    expect(partsFormFieldNames(PAGE)).toEqual(["_csrf", "reference"]);
    expect(buildPartsSearchBody("214996296R", "TK")).toBe("reference=214996296R&_csrf=TK");
  });
  it("un seul login, pas de retry, verrou mono-session, aucune écriture", () => {
    const src = readFileSync("src/lib/ixellio-parts.server.ts", "utf8");
    expect(src.match(/openIxellioSession\(/g)).toHaveLength(1);
    expect(src).toContain("busy");
    expect(src).not.toMatch(/supabase|\.insert\(|\.update\(/);
  });
});
