import { describe, expect, it } from "vitest";
import { finishCheck, notUsedMotifError, usageNeedsMotif } from "@/lib/parts-rules";
import { filterBySupplier, orderTrackLabel, supplierFilterOptions } from "@/lib/shipment-rules";

const line = (o: Partial<{ qty_ordered: number; qty_shipped: number; qty_received: number }>) => ({ line_kind: "part", status: "ordered", qty_ordered: 1, qty_shipped: 0, qty_received: 0, ...o });

describe("OR 50888 — suivi atelier", () => {
  it("commandée sans expédition", () => expect(orderTrackLabel({ status: "ordered", part_order_lines: [line({})] })).toBe("Commandée"));
  it("expédiée dès qty_shipped > 0", () => expect(orderTrackLabel({ status: "ordered", part_order_lines: [line({ qty_shipped: 1 })] })).toBe("Expédiée"));
  it("partiellement expédiée", () => expect(orderTrackLabel({ status: "ordered", part_order_lines: [line({ qty_ordered: 2, qty_shipped: 1 })] })).toBe("Partiellement expédiée"));
  it("reçue après réception physique", () => expect(orderTrackLabel({ status: "received", part_order_lines: [line({ qty_shipped: 1, qty_received: 1 })] })).toBe("Reçue"));
  it("partiellement reçue", () => expect(orderTrackLabel({ status: "partial", part_order_lines: [line({ qty_ordered: 2, qty_shipped: 1, qty_received: 1 })] })).toBe("Partiellement reçue — reliquat"));
});

describe("Pointage pièces", () => {
  it("ligne neuve = à pointer, clôture bloquée", () => expect(finishCheck([{ usage_status: "pending" }])).toEqual({ pending: 1, canFinishCleanly: false }));
  it("montée = traitée", () => expect(finishCheck([{ usage_status: "used" }]).canFinishCleanly).toBe(true));
  it("non utilisée exige un motif", () => {
    expect(notUsedMotifError("", "")).not.toBeNull();
    expect(notUsedMotifError("Autre", "")).not.toBeNull();
    expect(notUsedMotifError("Mauvaise référence", "")).toBeNull();
    expect(usageNeedsMotif({ usage_status: "not_used", reason: null, comment: null })).toBe(true);
    expect(finishCheck([{ usage_status: "not_used", reason: "Client a refusé" }]).canFinishCleanly).toBe(true);
  });
  it("OR sans pièce = clôture possible", () => expect(finishCheck([]).canFinishCleanly).toBe(true));
});

describe("Filtre fournisseur réception", () => {
  const orders = [{ supplier_id: "a", suppliers: { name: "AUTODOC" } }, { supplier_id: "d", suppliers: { name: "DISTRICASH" } }, { supplier_id: "d", suppliers: { name: "DISTRICASH" } }];
  it("compteurs", () => expect(supplierFilterOptions(orders)).toEqual([{ id: "a", name: "AUTODOC", count: 1 }, { id: "d", name: "DISTRICASH", count: 2 }]));
  it("filtre et tous", () => { expect(filterBySupplier(orders, "d")).toHaveLength(2); expect(filterBySupplier(orders, "")).toHaveLength(3); });
});
