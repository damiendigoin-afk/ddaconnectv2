import { describe, expect, it } from "vitest";
import { receiptDocKind, receiptDocState, receiptDocWarnings } from "@/lib/receipt-docs-rules";

const orleans = { receipt_type: "physical_without_document", source_document_id: null, status: "validated" };

describe("documents rattachés à une réception existante", () => {
  it("ORLEANS SUD AUTO / OR 16533 / DC-354-ZH : en attente tant qu'aucun document", () => {
    expect(receiptDocState(orleans, [])).toBe("awaiting");
  });
  it("facture rattachée non contrôlée => Facture à contrôler", () => {
    expect(receiptDocState({ ...orleans, source_document_id: "d1" }, [{ id: "d1", status: "a_verifier", extracted: { doc_kind: "facture", invoice_number: "F1" } }])).toBe("invoice_to_check");
  });
  it("BL rattaché => Document reçu", () => {
    expect(receiptDocState({ ...orleans, source_document_id: "d1" }, [{ id: "d1", status: "valide", extracted: { doc_kind: "bl" } }])).toBe("doc_received");
  });
  it("non-régression : réception créée avec BL reste Validée", () => {
    expect(receiptDocState({ receipt_type: "document", source_document_id: "d9", status: "validated" }, [{ id: "d9", status: "valide", extracted: { doc_kind: "bl" } }])).toBe("none");
  });
  it("type détecté", () => {
    expect(receiptDocKind({ doc_kind: "facture" })).toBe("facture");
    expect(receiptDocKind({ delivery_note_number: "914776" })).toBe("bl");
  });
  it("cohérence : aucun avertissement sur le bon document, écarts signalés sinon", () => {
    const r = { supplier_name: "SOCIETE ORLEANS SUD AUTO", or_number: "16533", plate: "DC-354-ZH", lines: [{ physical_reference: "133378273", qty_received: 1 }] };
    expect(receiptDocWarnings(r, { supplier: "Société Orléans Sud Auto", or_number: "16533", plate: "DC354ZH", lines: [{ reference: "133378273", label: null, quantity: 1, unit_price: null, discount_pct: null, amount: null }] })).toEqual([]);
    expect(receiptDocWarnings(r, { plate: "AA-111-AA", lines: [{ reference: "133378273", label: null, quantity: 2, unit_price: null, discount_pct: null, amount: null }] })).toHaveLength(2);
  });
});
