import { describe, expect, it } from "vitest";
import { orNumbersFromText, purchaseRules } from "../doc-rules";
import { normalizePurchaseExtract } from "../purchase-extract";
import { groupLinesByOr } from "../parts-site";

// Texte type de order-packing-list-180086499.pdf (AUTODOC).
const AUTODOC = `AUTODOC SE
Josef-Orlopp-Straße 55 10365 Berlin
Liste de colisage
N° de commande : 180086499
Date : 29/09/2026
Référence : 16952 17072
Véhicule : DP-043-WB
Article Désignation Qté Prix
ECD-FR-016 NTY Capteur de pression de turbo 1 11,66 €
818878 VALEO Intercooler 1 75,41 €`;

describe("commande fournisseur multi-OR (AUTODOC 180086499)", () => {
  it("champ Référence => deux repères OR distincts", () => {
    expect(orNumbersFromText("Référence : 16952 17072")).toEqual(["16952", "17072"]);
    expect(orNumbersFromText("Repères : 16952, 17072 et 50320")).toEqual(["16952", "17072", "50320"]);
    expect(orNumbersFromText("Référence : 180086499")).toEqual([]);
  });
  it("lecture complète sans IA", () => {
    const x = normalizePurchaseExtract(purchaseRules(AUTODOC, { suppliers: [{ name: "AUTODOC SE" }] }));
    expect(x.supplier).toBe("AUTODOC SE");
    expect(x.order_reference).toBe("180086499");
    expect(x.document_date).toBe("2026-09-29");
    expect(x.or_numbers).toEqual(["16952", "17072"]);
    expect(x.or_number).toBe("16952");
    expect(x.plate).toBe("DP-043-WB");
    expect(x.lines).toHaveLength(2);
    expect(x.lines![0]).toMatchObject({ reference: "ECD-FR-016", quantity: 1, unit_price: 11.66 });
    expect(x.lines![0]!.label).toMatch(/Capteur de pression de turbo/);
    expect(x.lines![1]).toMatchObject({ reference: "818878", quantity: 1, unit_price: 75.41 });
  });
  it("affectation des lignes par OR : une commande par OR, lignes non affectées au premier", () => {
    const g = groupLinesByOr(["16952", "17072"], [{ ref: "A", or: "17072" }, { ref: "B", or: null }]);
    expect(g).toEqual([{ or: "16952", lines: [{ ref: "B", or: null }] }, { or: "17072", lines: [{ ref: "A", or: "17072" }] }]);
  });
});
