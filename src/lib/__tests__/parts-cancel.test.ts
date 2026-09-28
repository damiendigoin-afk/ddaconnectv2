import { describe, expect, it } from "vitest";
import { applyMovements, assertCancellable, cancelOrderLines, movementDeltas, orderLineAfterReceiptCancel, orderStatus, reversalMoves } from "@/lib/parts-rules";
import { pendingReceptionOrders } from "@/lib/parts-site";

const z = { available: 5, allocated: 1, quarantine: 0 };

describe("annulation de réception", () => {
  const hist = [
    { id: "m1", ...movementDeltas("receipt_in", 3) },
    { id: "m2", ...movementDeltas("allocate_to_or", 2) },
    { id: "m3", ...movementDeltas("damaged_quarantine", 1) },
  ];
  it("remet le stock exactement dans l'état précédent", () => {
    const after = applyMovements(z, hist);
    const rev = reversalMoves(hist);
    expect(applyMovements(after, rev)).toEqual(z);
  });
  it("n'inverse qu'une seule fois", () => {
    const rev = reversalMoves(hist).map((r, i) => ({ id: `r${i}`, is_reversal: true, ...r }));
    expect(reversalMoves([...hist, ...rev])).toEqual([]);
  });
  it("refuse la double annulation et exige un motif", () => {
    expect(() => assertCancellable("receipt", "cancelled", "erreur de saisie")).toThrow(/déjà annulée/);
    expect(() => assertCancellable("receipt", "validated", " ")).toThrow(/Motif/);
    expect(() => assertCancellable("receipt", "validated", "doublon")).not.toThrow();
  });
  it("remet le reliquat de la commande et la rouvre", () => {
    const l = orderLineAfterReceiptCancel({ qty_ordered: 2, qty_received: 2, status: "received" }, 2);
    expect(l).toEqual({ qty_received: 0, status: "ordered" });
    expect(orderLineAfterReceiptCancel({ qty_ordered: 4, qty_received: 3, status: "partial" }, 1)).toEqual({ qty_received: 2, status: "partial" });
    expect(orderStatus([{ status: l.status, line_kind: "part" }], false)).toBe("ordered");
  });
});

describe("annulation de commande", () => {
  it("disparaît des commandes en attente", () => {
    expect(pendingReceptionOrders([{ status: "ordered" }, { status: "cancelled" }, { status: "partial" }])).toHaveLength(2);
  });
  it("n'annule que le reliquat et garde le reçu tracé", () => {
    const r = cancelOrderLines([
      { status: "received", line_kind: "part", qty_received: 2 },
      { status: "partial", line_kind: "part", qty_received: 1 },
      { status: "ordered", line_kind: "part", qty_received: 0 },
    ]);
    expect(r.alreadyReceived).toBe(3);
    expect(r.lines.map((l) => l.status)).toEqual(["received", "cancelled", "cancelled"]);
    expect(() => assertCancellable("order", "received", "erreur")).toThrow(/réception/);
  });
});
