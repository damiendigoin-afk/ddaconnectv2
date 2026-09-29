import { describe, expect, it } from "vitest";
import { purchaseRules, orderDate, DOC_SPECS, missingFields } from "@/lib/doc-rules";
import { normalizePurchaseExtract } from "@/lib/purchase-extract";
import { matchSupplier } from "@/lib/parts-site";
import { parsePriceInput, formatPriceInput, isPriceTyping } from "@/lib/price-input";
import { orderFormLinesFromDoc } from "@/lib/receipt-lines";

// Structure texte réelle de la commande Pièce Auto Discount / OSKARBI AUTO SL n°2887082 (29/09/2026).
// Le repère OR 17072 est imprimé sous la désignation ; le fournisseur n'apparaît qu'en pied de page.
const PAD_A = `Adresse de facturation
DAMIEN DIGOIN AUTOMOBILE
Règlement En compte
COMMANDE 2887082
Date Montant Paiement Payée le Status
29/09/2026 56,00 € SEPA 29/09/2026 12:24:59 A traiter
Qté Cod. Article Designation Prix Unitaire Prix
1 5571201 Grille inférieure pare-chocs avant 43,10 € 43,10 €
17072
Sous-total 43,10 €
Frais de port 12,90 €
Total 56,00 €
TVA 0,00 €
OSKARBI AUTO SL · ANTXOTXIPI 9, POL. IND. ZAISA III · 20305 - IRUN / ESPAGNE`;

// Variante de regroupement : prix alignés sur la ligne du repère OR (sous la désignation).
const PAD_B = PAD_A.replace("1 5571201 Grille inférieure pare-chocs avant 43,10 € 43,10 €\n17072", "1 5571201 Grille inférieure pare-chocs avant\n17072 43,10 € 43,10 €");

describe.each([["prix sur la ligne article", PAD_A], ["prix sur la ligne du repère OR", PAD_B]])("commande PAD 2887082 (%s)", (_n, text) => {
  const raw = purchaseRules(text);
  const x = normalizePurchaseExtract(raw);
  it("fournisseur lu en pied de page", () => expect(x.supplier).toBe("OSKARBI AUTO SL"));
  it("n° commande, date de commande (pas « Payée le »), totaux", () => {
    expect(x.order_reference).toBe("2887082");
    expect(x.order_date).toBe("2026-09-29");
    expect(x.total_ttc).toBe(56);
    expect(x.vat_amount).toBe(0);
    expect(x.shipping_ht).toBe(12.9);
  });
  it("une seule ligne article, OR 17072 jamais pris pour une référence", () => {
    expect(x.lines).toHaveLength(1);
    expect(x.lines?.[0]).toMatchObject({ reference: "5571201", label: "Grille inférieure pare-chocs avant", quantity: 1, unit_price: 43.1 });
    expect(x.or_number).toBe("17072");
    expect(x.or_numbers).toEqual(["17072"]);
  });
  it("mapping formulaire : pièce + port en frais, sans faux article", () => {
    expect(orderFormLinesFromDoc(x)).toEqual([
      { line_kind: "part", physical_reference: "5571201", designation: "Grille inférieure pare-chocs avant", qty_ordered: 1, expected_unit_cost_ht: 43.1 },
      { line_kind: "fee", physical_reference: "", designation: "Frais de port", qty_ordered: 1, expected_unit_cost_ht: 12.9 },
    ]);
  });
  it("lecture jugée complète (fournisseur, lignes, date)", () => expect(missingFields(DOC_SPECS.purchase, raw)).toEqual([]));
});

describe("fournisseur connu sous son enseigne", () => {
  it("fiche « PIECE AUTO DISCOUNT » avec alias OSKARBI AUTO SL", () => {
    const sups = [{ id: "pad", name: "PIECE AUTO DISCOUNT", notes: "Alias : OSKARBI AUTO SL" }, { id: "o", name: "AUTODOC SE", notes: null }];
    expect(matchSupplier("OSKARBI AUTO SL", sups)?.id).toBe("pad");
    const raw = purchaseRules(PAD_A, { suppliers: [{ name: "PIECE AUTO DISCOUNT", aliases: ["OSKARBI AUTO SL"] }] });
    expect(raw["supplier"]).toBe("PIECE AUTO DISCOUNT");
  });
});

describe("date de commande", () => {
  it("libellé explicite prioritaire sur « Payée le »", () => {
    expect(orderDate("Payée le 30/09/2026\nDate de commande : 28/09/2026")).toBe("2026-09-28");
  });
  it("aucune date => null (l'écran met la date du jour)", () => expect(orderDate("COMMANDE 123456")).toBeNull());
});

describe("saisie PA HT", () => {
  it("frappe libre : chiffres + un séparateur", () => {
    for (const v of ["", "0", "43", "43,", "43.", "43,1", "43,10", "43.10", ",5"]) expect(isPriceTyping(v)).toBe(true);
    for (const v of ["43,1,0", "4a", "43.10.2", "43,105"]) expect(isPriceTyping(v)).toBe(false);
  });
  it("normalisation au blur/validation", () => {
    expect(parsePriceInput("43,10")).toBe(43.1);
    expect(parsePriceInput("43.10")).toBe(43.1);
    expect(parsePriceInput("43,1")).toBe(43.1);
    expect(parsePriceInput("0")).toBe(0);
    expect(parsePriceInput("")).toBeNull();
    expect(formatPriceInput(43.1)).toBe("43,10");
    expect(formatPriceInput(null)).toBe("");
  });
});
