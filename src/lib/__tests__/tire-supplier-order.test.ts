import { describe, expect, it } from "vitest";
import { canOrderOffer, districashAccountForSite, findTireOrderDuplicate, tireOrderLine, validateSupplierConfirmation, validateTireOrderTarget } from "../tire-supplier-order";
import { pendingReceptionOrders } from "../parts-site";
import type { SevenOffer } from "../tires";

const offer = { available: true, supplier: "districash", supplierRef: "2055516VSH32", unitSourceHt: 61.5, quantity: 2, brand: "SAILUN", model: "ELITE SH32", size: "205/55R16", loadIndex: "91", speedIndex: "V" } as unknown as SevenOffer;

describe("commande pneus Districash (interne)", () => {
  it("compte du site émetteur, jamais croisé", () => {
    expect(districashAccountForSite("castillon")).toBe("19025");
    expect(districashAccountForSite("dda")).toBe("60669");
    expect(districashAccountForSite(null)).toBeNull();
  });
  it("OR ou immatriculation obligatoire", () => {
    expect(validateTireOrderTarget({ orNumber: "", plate: "" })).not.toBeNull();
    expect(validateTireOrderTarget({ orNumber: "17264", plate: "" })).toBeNull();
    expect(validateTireOrderTarget({ orNumber: "", plate: "ab-123-cd" })).toBeNull();
    expect(validateTireOrderTarget({ orNumber: "OR17", plate: "" })).not.toBeNull();
  });
  it("seules les offres Districash disponibles avec réf. et PA sont commandables", () => {
    expect(canOrderOffer(offer)).toBe(true);
    expect(canOrderOffer({ ...offer, supplier: "centralepneus" })).toBe(false);
    expect(canOrderOffer({ ...offer, available: false })).toBe(false);
    expect(canOrderOffer({ ...offer, supplierRef: null })).toBe(false);
  });
  it("ligne : réf., quantité du devis et PA HT", () => {
    expect(tireOrderLine(offer)).toMatchObject({ physical_reference: "2055516VSH32", qty_ordered: 2, expected_unit_cost_ht: 61.5 });
  });
  it("doublon = même fournisseur + réf. + OR ou immat", () => {
    const ex = [{ id: "a", status: "to_transmit", supplier_id: "S", requested_or_number: "17264", plate: "AB123CD", part_order_lines: [{ physical_reference: "2055516VSH32" }] }];
    expect(findTireOrderDuplicate({ supplierId: "S", ref: "2055516vsh32", orNumber: "17264", plate: "" }, ex)?.id).toBe("a");
    expect(findTireOrderDuplicate({ supplierId: "S", ref: "2055516VSH32", orNumber: "", plate: "ab-123-cd" }, ex)?.id).toBe("a");
    expect(findTireOrderDuplicate({ supplierId: "X", ref: "2055516VSH32", orNumber: "17264", plate: "" }, ex)).toBeNull();
    expect(findTireOrderDuplicate({ supplierId: "S", ref: "AUTRE", orNumber: "17264", plate: "" }, ex)).toBeNull();
    expect(findTireOrderDuplicate({ supplierId: "S", ref: "2055516VSH32", orNumber: "17264", plate: "" }, [{ ...ex[0]!, status: "cancelled" }])).toBeNull();
  });
  it("« Commandée » exige un n° fournisseur réel", () => {
    expect(validateSupplierConfirmation("")).not.toBeNull();
    expect(validateSupplierConfirmation("CMD-445512")).toBeNull();
  });
  it("une commande à transmettre reste attendue en réception", () => {
    expect(pendingReceptionOrders([{ status: "to_transmit" }, { status: "received" }])).toHaveLength(1);
  });
});

import { districashCartFields } from "../tire-supplier-order";
describe("aide panier Districash", () => {
  it("référence = « OR: n° » prioritaire", () => {
    expect(districashCartFields({ orNumber: " 17264 ", plate: "ab-123-cd" })).toEqual({ reference: "OR: 17264", immatriculation: "AB123CD" });
  });
  it("pas de préfixe OR doublé", () => {
    expect(districashCartFields({ orNumber: "OR 17264", plate: "" }).reference).toBe("OR: 17264");
    expect(districashCartFields({ orNumber: "or:17264", plate: "" }).reference).toBe("OR: 17264");
  });
  it("référence = immatriculation sans OR", () => {
    expect(districashCartFields({ orNumber: "", plate: "ab-123-cd" })).toEqual({ reference: "AB123CD", immatriculation: "AB123CD" });
  });
});

import { parseOrderTarget } from "../tire-supplier-order";
describe("parseOrderTarget (champ unique OR ou immat)", () => {
  it("reconnaît les OR", () => {
    for (const v of ["78546", "OR: 78546", "or 78546", " OR:78546 "]) expect(parseOrderTarget(v)).toEqual({ orNumber: "78546", plate: "" });
  });
  it("reconnaît les plaques", () => {
    expect(parseOrderTarget("EE111EE")).toEqual({ orNumber: "", plate: "EE111EE" });
    expect(parseOrderTarget("ee-111-ee")).toEqual({ orNumber: "", plate: "EE111EE" });
    expect(parseOrderTarget("123 AB 24")).toEqual({ orNumber: "", plate: "123AB24" });
  });
  it("refuse le reste", () => {
    for (const v of ["", "AB", "OR: abc", "12"]) expect("error" in parseOrderTarget(v)).toBe(true);
  });
});
