import { describe, expect, it } from "vitest";
import { checkOrderEdit, editPayloadLines, isEngaged, lockedFields, type ExistingLine } from "@/lib/order-edit-rules";

const base = (p: Partial<ExistingLine>): ExistingLine => ({ id: "l1", line_kind: "part", physical_reference: "557119W", designation: "Support", qty_ordered: 2, expected_unit_cost_ht: 24.51, qty_received: 0, ...p });
const ctx = { hasReceipts: false, orChanged: false, destinationChanged: false, supplierChanged: false, invoiceLinked: false };

describe("modification manuelle de commande", () => {
  it("commande validée sans réception : tout est éditable, mêmes ID de lignes conservés", () => {
    const before = [base({}), base({ id: "l2", physical_reference: "5571208" })];
    const after = [{ ...before[0]!, physical_reference: "557119X", qty_ordered: 3, expected_unit_cost_ht: 20 }, { ...before[1]!, line_kind: "fee" as const }];
    expect(checkOrderEdit(before, after, ctx).errors).toEqual([]);
    expect(editPayloadLines(after).map((l) => l.id)).toEqual(["l1", "l2"]);
  });
  it("ajout et suppression de lignes non engagées ; ligne nouvelle vide ignorée", () => {
    const before = [base({}), base({ id: "l2" })];
    const after = [before[0]!, { id: null, line_kind: "part" as const, physical_reference: "NEW", designation: "", qty_ordered: 1, expected_unit_cost_ht: null }, { id: null, line_kind: "part" as const, physical_reference: " ", designation: "", qty_ordered: 1, expected_unit_cost_ht: null }];
    expect(checkOrderEdit(before, after, ctx).errors).toEqual([]);
    expect(editPayloadLines(after).map((l) => l.id)).toEqual(["l1", null]);
  });
  it("réception partielle : référence/type figés, qté ≥ reçu, suppression refusée, désignation/PA éditables", () => {
    const b = base({ qty_received: 1 });
    expect(isEngaged(b)).toBe(true);
    expect(lockedFields(b)).toEqual(["line_kind", "physical_reference"]);
    expect(checkOrderEdit([b], [{ ...b, designation: "Support AV D", expected_unit_cost_ht: 22 }], ctx).errors).toEqual([]);
    expect(checkOrderEdit([b], [{ ...b, physical_reference: "AUTRE" }], ctx).errors.length).toBe(1);
    expect(checkOrderEdit([b], [{ ...b, qty_ordered: 0 }], ctx).errors[0]).toMatch(/déjà reçu/);
    expect(checkOrderEdit([b], [], ctx).errors[0]).toMatch(/suppression impossible/);
  });
  it("facture liée : ligne engagée même sans quantité reçue, alerte fournisseur", () => {
    const b = base({ invoiced: true });
    const r = checkOrderEdit([b], [{ ...b, line_kind: "fee" }], { ...ctx, invoiceLinked: true, supplierChanged: true });
    expect(r.errors.length).toBe(1);
    expect(r.warnings.join()).toMatch(/facture/);
  });
  it("changement d'OR / destination après réception : alertes explicites, pas de blocage", () => {
    const b = base({ qty_received: 2 });
    const r = checkOrderEdit([b], [b], { ...ctx, hasReceipts: true, orChanged: true, destinationChanged: true });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(2);
  });
  it("ligne étrangère à la commande refusée", () => {
    expect(checkOrderEdit([base({})], [base({ id: "autre" })], ctx).errors).toContain("Ligne étrangère à cette commande");
  });
  it("affectation OR par ligne transmise", () => {
    const p = editPayloadLines([{ ...base({}), repair_order_id: "or-1", requested_or_number: " 16533 " }]);
    expect(p[0]).toMatchObject({ repair_order_id: "or-1", requested_or_number: "16533" });
  });
});
