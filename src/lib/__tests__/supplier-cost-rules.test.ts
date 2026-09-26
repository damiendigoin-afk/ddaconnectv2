import { describe, expect, it } from "vitest";
import {
  isCreditDoc,
  lineGapAbs,
  matchReceiptLine,
  pampAfterCostCorrection,
  supplierLineKey,
  withinTolerance,
  type ReceiptCandidate,
} from "@/lib/supplier-cost-rules";

const cand = (p: Partial<ReceiptCandidate>): ReceiptCandidate => ({
  id: "r1", qty_received: 2, reference_normalized: "ABC123", source_document_id: null,
  supplier_name: "Autodistribution", already_costed_by_other_doc: false, ...p,
});

describe("tolérance prix", () => {
  it("<= 1 € par ligne validé, > 1 € alerte", () => {
    expect(withinTolerance(lineGapAbs(2, 10.5, 10))).toBe(true); // 1 €
    expect(withinTolerance(lineGapAbs(3, 10.5, 10))).toBe(false); // 1,5 €
    expect(withinTolerance(lineGapAbs(3, 10.5, null))).toBe(true);
  });
});

describe("PAMP corrigé sans quantité", () => {
  it("revalorise la part encore en stock", () => {
    // 4 en stock à 10 ; 2 reçues à 10 provisoire, réel 13 → (40 + 2*3)/4
    expect(pampAfterCostCorrection(4, 10, 2, 10, 13)).toBe(11.5);
  });
  it("part déjà sortie non revalorisée", () => {
    expect(pampAfterCostCorrection(1, 10, 2, 10, 13)).toBe(13);
  });
  it("stock nul : PAMP inchangé", () => {
    expect(pampAfterCostCorrection(0, 10, 2, 10, 13)).toBe(10);
  });
  it("idempotent : réappliquer le même coût réel ne dérive pas", () => {
    const p1 = pampAfterCostCorrection(4, 10, 2, 10, 13)!;
    expect(pampAfterCostCorrection(4, p1, 2, 13, 13)).toBe(p1);
  });
  it("recontrôle avec prix modifié : seul le delta est appliqué", () => {
    const p1 = pampAfterCostCorrection(4, 10, 2, 10, 13)!;
    const p2 = pampAfterCostCorrection(4, p1, 2, 13, 12)!;
    expect(p2).toBe(pampAfterCostCorrection(4, 10, 2, 10, 12));
  });
});

describe("rapprochement certain", () => {
  it("un seul candidat même réf/qté/fournisseur", () => {
    expect(matchReceiptLine({ reference: "abc-123", qty: 2 }, "d", "AUTODISTRIBUTION", [cand({})])).toBe("r1");
  });
  it("ambigu ou quantité différente → rien", () => {
    expect(matchReceiptLine({ reference: "ABC123", qty: 2 }, "d", "Autodistribution", [cand({}), cand({ id: "r2" })])).toBeNull();
    expect(matchReceiptLine({ reference: "ABC123", qty: 3 }, "d", "Autodistribution", [cand({})])).toBeNull();
    expect(matchReceiptLine({ reference: null, qty: 2 }, "d", null, [cand({})])).toBeNull();
  });
  it("réception issue du même document prioritaire", () => {
    expect(matchReceiptLine({ reference: "ABC123", qty: 2 }, "d", "X", [cand({}), cand({ id: "r2", source_document_id: "d" })])).toBe("r2");
  });
  it("déjà valorisée par une autre facture → exclue", () => {
    expect(matchReceiptLine({ reference: "ABC123", qty: 2 }, "d", "Autodistribution", [cand({ already_costed_by_other_doc: true })])).toBeNull();
  });
});

describe("divers", () => {
  it("clé stable et avoir détecté", () => {
    expect(supplierLineKey(0, "abc 123")).toBe(supplierLineKey(0, "ABC-123"));
    expect(isCreditDoc("Avoir", null)).toBe(true);
    expect(isCreditDoc("facture", -5)).toBe(true);
    expect(isCreditDoc("facture", 10)).toBe(false);
  });
});
