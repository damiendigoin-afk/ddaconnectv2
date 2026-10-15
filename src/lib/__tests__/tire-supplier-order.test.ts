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
