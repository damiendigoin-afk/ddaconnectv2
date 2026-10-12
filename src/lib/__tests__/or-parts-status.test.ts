import { describe, it, expect } from "vitest";
import { orPartsStatus, type StatusReceiptLine, type StatusUsage } from "../or-parts-status";

const OR = "45b92d7a-53ee-4571-bba7-86ccf8f375ce";
const CAZES = "2e3d343a-1548-42d9-89c6-24c94bae6d4a";
const OSK = "2276edbd-0a4a-495e-b1dd-544ff810ef78";
const rl = (id: string, receipt: string, supplier: string, p: Partial<StatusReceiptLine["part_receipts"] & object> = {}, ro: string | null = OR): StatusReceiptLine => ({
  id, repair_order_id: ro, qty_received: 1, condition: "usable",
  part_receipts: { id: receipt, order_id: null, status: "validated", repair_order_id: OR, supplier_name: supplier, ...p },
});
const lines17007 = [
  rl("4a2a", CAZES, "CAZES"), rl("7a13", CAZES, "CAZES"), rl("bac7", CAZES, "CAZES"), rl("f7c9", CAZES, "CAZES"),
  rl("f06f", OSK, "OSKARBI AUTO SL"),
];
const pending = (n: number): StatusUsage[] => Array.from({ length: n }, () => ({ usage_status: "pending", qty_allocated: 1 }));

describe("statut pièces OR : commandes + réceptions directes", () => {
  it("OR 17007 : 0 commande + 2 réceptions directes + 5 pending", () => {
    const s = orPartsStatus(OR, [], lines17007, pending(5));
    expect(s.kind).toBe("direct");
    expect(s.direct.total).toBe(5);
    expect(s.direct.sources).toEqual([
      { supplier: "CAZES", receiptIds: [CAZES], qty: 4 },
      { supplier: "OSKARBI AUTO SL", receiptIds: [OSK], qty: 1 },
    ]);
    expect(s.usage).toEqual({ atGarage: 5, toPoint: 5, used: 0 });
  });
  it("vrai cas zéro => none", () => {
    expect(orPartsStatus(OR, [], [], []).kind).toBe("none");
  });
  it("commande normale uniquement : comportement inchangé", () => {
    const s = orPartsStatus(OR, [{ id: "o1", status: "ordered", part_order_lines: [{ id: "l1", qty_ordered: 2, qty_received: 1 }, { id: "l2", qty_ordered: 1, qty_received: 1 }] }], [], []);
    expect(s.kind).toBe("orders");
    expect(s.completeness).toEqual({ kind: "incomplete", done: 1, total: 2 });
  });
  it("commande + réception directe : pas de double comptage", () => {
    const viaOrder = rl("x1", "r-order", "PAD", { order_id: "o1" });
    const s = orPartsStatus(OR, [{ id: "o1", status: "received", part_order_lines: [{ id: "l1", qty_ordered: 1, qty_received: 1 }] }], [viaOrder, lines17007[4]!], pending(2));
    expect(s.kind).toBe("mixed");
    expect(s.direct.total).toBe(1);
    expect(s.direct.sources.map((x) => x.supplier)).toEqual(["OSKARBI AUTO SL"]);
    expect(s.completeness).toEqual({ kind: "complete", done: 1, total: 1 });
  });
  it("order_id null mais repair_order_id lié => comptée", () => {
    expect(orPartsStatus(OR, [], [rl("a", "r", "X")], []).direct.total).toBe(1);
  });
  it("réception non validée ou autre OR => non comptée", () => {
    const s = orPartsStatus(OR, [], [rl("a", "r", "X", { status: "cancelled" }), rl("b", "r2", "Y", {}, "autre-or")], []);
    expect(s.direct.total).toBe(0);
    expect(s.kind).toBe("none");
  });
  it("5 usages : 2 utilisées => 3 à pointer", () => {
    const u: StatusUsage[] = [...pending(3), { usage_status: "used", qty_allocated: 1 }, { usage_status: "partial", qty_allocated: 1 }];
    expect(orPartsStatus(OR, [], lines17007, u).usage).toEqual({ atGarage: 5, toPoint: 3, used: 2 });
  });
  it("aucune commande créée : le statut est calculé sans part_order", () => {
    const orders: never[] = [];
    orPartsStatus(OR, orders, lines17007, pending(5));
    expect(orders).toHaveLength(0);
  });
});
