import { describe, expect, it } from "vitest";
import { parseItemLines, parseItemLinesTolerant, purchaseRules } from "../doc-rules";

describe("order_*.pdf : seconde passe tolérante", () => {
  const TXT = `Commande N° 66106533\nDate : 01/10/2026\nArticle | Désignation | Qté | PU HT | Total HT\n7701208265 | FILTRE A HUILE | 2 | 8,40 | 16,80\nOC 90 ; Filtre huile moteur ; x1 ; 12,15\nTotal HT 28,95\nTVA 5,79`;
  it("extrait références, désignations, quantités et PA", () => {
    const l = parseItemLines(TXT);
    expect(l.map((x) => x.reference)).toEqual(["7701208265"]);
    expect(l[0]).toMatchObject({ label: expect.stringContaining("FILTRE A HUILE"), quantity: 2, unit_price: 8.4 });
  });
  it("ignore totaux, TVA, dates et n'invente rien sans article", () => {
    expect(parseItemLinesTolerant("Total HT 28,95\nTVA 5,79\nDate 01/10/2026")).toEqual([]);
    expect((purchaseRules("Commande 66106533\nMerci").lines as unknown[]).length).toBe(0);
  });
  it("quantité par défaut 1", () => {
    expect(parseItemLinesTolerant("ABC1234 Plaquettes de frein AV 45,90")[0]).toMatchObject({ reference: "ABC1234", quantity: 1, unit_price: 45.9 });
  });
});
