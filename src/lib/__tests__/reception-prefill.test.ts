import { describe, expect, it } from "vitest";
import { linesAfterOrderPick, receiptLinesFromOrder, receiptPrefillQty } from "@/lib/receipt-lines";
import { orderLineStatus } from "@/lib/parts-rules";
import { orderLineFromProcurement } from "@/lib/procurement-rules";

const l = (o: Partial<{ qty_ordered: number; qty_received: number; qty_shipped: number; status: string }> = {}) => ({ id: "l1", line_kind: "part", physical_reference: "ABC123", designation: "Pièce", qty_ordered: 4, qty_received: 0, qty_shipped: 0, status: "ordered", ...o });

describe("réception préremplie", () => {
  it("1) qté 4, reçue 0 → 4", () => expect(receiptLinesFromOrder([l()], "or")[0]!.qty_received).toBe(4));
  it("2) qté 4, reçue 1 → 3", () => expect(receiptLinesFromOrder([l({ qty_received: 1, status: "partial" })], "or")[0]!.qty_received).toBe(3));
  it("3) BL annonce 2 sur reliquat 4 → 2", () => {
    expect(linesAfterOrderPick([l()], [{ reference: "ABC-123", quantity: 2 }], "or", true)[0]!.qty_received).toBe(2);
    expect(receiptPrefillQty(l({ qty_shipped: 2 }))).toBe(2);
  });
  it("3b) BL au-delà du reliquat → plafonné au reliquat", () => expect(receiptPrefillQty(l({ qty_received: 3, status: "partial" }), 5)).toBe(1));
  it("3c) ligne absente du BL → 0 (pas dans ce colis)", () => expect(linesAfterOrderPick([l()], [{ reference: "ZZZ999", quantity: 1 }], "or", true)[0]!.qty_received).toBe(0));
  it("4) ligne totalement reçue → 0 / non proposée", () => {
    const done = l({ qty_received: 4, status: "received" });
    expect(receiptPrefillQty(done)).toBe(0);
    expect(receiptLinesFromOrder([done], "or")).toHaveLength(0);
  });
  it("5) modification 4 → 3 : seules les valeurs affichées sont envoyées", () => {
    const [x] = receiptLinesFromOrder([l()], "or");
    const edited = { ...x!, qty_received: 3, allocate_qty: 3 };
    expect(edited.qty_received).toBe(3);
    expect(orderLineStatus(4, edited.qty_received)).toBe("partial");
  });
  it("6) préremplir ne modifie pas la ligne de commande (aucun qty_received avant clic)", () => {
    const src = l();
    receiptLinesFromOrder([src], "or");
    expect(src.qty_received).toBe(0);
  });
  it("7) double validation : le second passage ne repropose que le reliquat (0 → rien)", () => {
    const after = l({ qty_received: 4, status: "received" });
    expect(receiptLinesFromOrder([after], "or")).toHaveLength(0);
  });
  it("8) réceptions partielles successives", () => {
    expect(receiptPrefillQty(l())).toBe(4);
    expect(receiptPrefillQty(l({ qty_received: 2, status: "partial" }))).toBe(2);
    expect(receiptPrefillQty(l({ qty_received: 3, status: "partial" }))).toBe(1);
  });
  it("9) commande issue d'une liste d'approvisionnement : PA vide, quantité préremplie", () => {
    const ol = orderLineFromProcurement({ reference: "8200670290", designation: "SUPPORT", quantity: 2, source_price_ht: 54.01 } as never);
    expect(ol.expected_unit_cost_ht).toBeNull();
    const [x] = receiptLinesFromOrder([{ id: "p1", line_kind: "part", physical_reference: ol.physical_reference, designation: ol.designation, qty_ordered: ol.qty_ordered, qty_received: 0, status: "ordered" }], "or");
    expect(x!.qty_received).toBe(2);
    expect(x!.unit_cost).toBeNull();
  });
});
