import { describe, expect, it } from "vitest";
import { defaultFreeReference, linesAfterOrderPick, receiptLinesFromDoc, receiptLinesFromOrder, simplifiedEnrichment } from "@/lib/receipt-lines";

const bl = [{ reference: "7711640502", label: "MICHELIN PNEU", quantity: 2, unit_price: 98.5 }];

describe("réception : repère libre et lignes BL", () => {
  it("handwritten_notes « cochée au stylo noir » => repère libre vide", () => {
    expect(defaultFreeReference({ handwritten_notes: "cochée au stylo noir" } as never)).toBe("");
  });
  it("BL 1 ligne + commande simplified 0 ligne => la ligne BL reste", () => {
    const r = linesAfterOrderPick([], bl, "unknown");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ physical_reference: "7711640502", qty_received: 2, unit_cost: 98.5, destination: "unknown", order_line_id: null });
  });
  it("simplified sans lignes et sans document => ligne vide", () => {
    const r = linesAfterOrderPick([], [], "stock");
    expect(r).toHaveLength(1);
    expect(r[0]!.physical_reference).toBe("");
  });
  it("commande detailed => lignes de commande inchangées", () => {
    const ol = [{ id: "l1", line_kind: "part", physical_reference: "ABC", designation: "Filtre", qty_ordered: 3, qty_received: 1, status: "partial" }];
    expect(linesAfterOrderPick(ol, bl, "or")).toEqual(receiptLinesFromOrder(ol, "or"));
  });
  it("enrichissement simplified : lignes à créer une seule fois, jamais sur detailed ou déjà liée", () => {
    const lines = receiptLinesFromDoc(bl);
    expect(simplifiedEnrichment({ order_mode: "simplified", line_count: 0 }, lines)).toHaveLength(1);
    expect(simplifiedEnrichment({ order_mode: "simplified", line_count: 1 }, lines)).toHaveLength(0);
    expect(simplifiedEnrichment({ order_mode: "detailed", line_count: 0 }, lines)).toHaveLength(0);
    expect(simplifiedEnrichment(null, lines)).toHaveLength(0);
    // une ligne déjà liée n'est pas recréée => un seul receipt_in par ligne reçue
    expect(simplifiedEnrichment({ order_mode: "simplified", line_count: 0 }, [{ ...lines[0]!, order_line_id: "x" }])).toHaveLength(0);
  });
});
