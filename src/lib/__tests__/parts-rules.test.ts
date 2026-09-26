import { describe, expect, it } from "vitest";
import {
  applyMovements,
  finishCheck,
  movementDeltas,
  nextPamp,
  orderLineStatus,
  orderStatus,
  partsCompleteness,
  stateAfterChange,
  isOverReceipt,
} from "@/lib/parts-rules";

const zero = { available: 0, allocated: 0, quarantine: 0 };

describe("mouvements de stock", () => {
  it("réception = + disponible", () => {
    expect(applyMovements(zero, [movementDeltas("receipt_in", 3)])).toEqual({ available: 3, allocated: 0, quarantine: 0 });
  });
  it("affectation OR = disponible − / affecté +", () => {
    const l = applyMovements(zero, [movementDeltas("receipt_in", 3), movementDeltas("allocate_to_or", 2)]);
    expect(l).toEqual({ available: 1, allocated: 2, quarantine: 0 });
  });
  it("utilisation technicien : aucun second mouvement, l'affectation est conservée", () => {
    const moves = [movementDeltas("receipt_in", 2), movementDeltas("allocate_to_or", 2)];
    // confirmer « utilisée » n'ajoute aucun mouvement
    expect(applyMovements(zero, moves)).toEqual({ available: 0, allocated: 2, quarantine: 0 });
  });
  it("désaffectation remet en disponible", () => {
    const l = applyMovements(zero, [movementDeltas("receipt_in", 2), movementDeltas("allocate_to_or", 2), movementDeltas("deallocate_from_or", 1)]);
    expect(l).toEqual({ available: 1, allocated: 1, quarantine: 0 });
  });
  it("retour fournisseur physique depuis quarantaine ou disponible", () => {
    const l = applyMovements(zero, [movementDeltas("damaged_quarantine", 1), movementDeltas("supplier_return_out", 1, { fromQuarantine: true })]);
    expect(l).toEqual(zero);
    expect(movementDeltas("supplier_return_out", 2).delta_available).toBe(-2);
  });
  it("correction manuelle signée, stock négatif possible", () => {
    const l = applyMovements(zero, [movementDeltas("manual_adjustment", -1)]);
    expect(l.available).toBe(-1);
  });
  it("vente finale OR (Phase C) sort de l'affecté", () => {
    expect(movementDeltas("or_sale_final", 2)).toEqual({ delta_available: 0, delta_allocated: -2, delta_quarantine: 0 });
  });
});

describe("PAMP", () => {
  it("premier achat = prix", () => expect(nextPamp(0, null, 2, 10)).toBe(10));
  it("moyenne pondérée", () => expect(nextPamp(2, 10, 2, 20)).toBe(15));
  it("sans prix : inchangé", () => expect(nextPamp(2, 10, 2, null)).toBe(10));
});

describe("commandes / réceptions", () => {
  it("statuts de ligne", () => {
    expect(orderLineStatus(2, 0)).toBe("ordered");
    expect(orderLineStatus(2, 1)).toBe("partial");
    expect(orderLineStatus(2, 3)).toBe("received");
  });
  it("sur-réception détectée", () => expect(isOverReceipt(2, 3)).toBe(true));
  it("commande simplifiée sans ligne", () => {
    expect(orderStatus([], false)).toBe("ordered");
    expect(orderStatus([], true)).toBe("received");
  });
  it("frais ignorés dans le statut", () => {
    expect(orderStatus([{ status: "received" }, { status: "ordered", line_kind: "fee" }], true)).toBe("received");
  });
  it("complétude", () => {
    expect(partsCompleteness({ simplifiedWithoutLines: 1, lines: [] })).toEqual({ kind: "unknown" });
    expect(partsCompleteness({ simplifiedWithoutLines: 0, lines: [{ qty_ordered: 2, qty_received: 1 }, { qty_ordered: 1, qty_received: 1 }] })).toEqual({ kind: "incomplete", done: 1, total: 2 });
  });
});

describe("travaux terminés", () => {
  it("modification après clôture => à revalider", () => {
    expect(stateAfterChange("travaux_termines")).toBe("a_revalider");
    expect(stateAfterChange("en_cours")).toBe("en_cours");
    expect(stateAfterChange(null)).toBe("en_cours");
  });
  it("contrôle non bloquant des lignes en attente", () => {
    expect(finishCheck([{ usage_status: "pending" }, { usage_status: "used" }])).toEqual({ pending: 1, canFinishCleanly: false });
  });
});
