import { describe, expect, it } from "vitest";
import { compareDocToOrder, receptionSuggestions } from "@/lib/parts-site";

const line = (ref: string, qo: number, qr = 0) => ({ physical_reference: ref, line_kind: "part", status: qr >= qo ? "received" : qr ? "partial" : "ordered", qty_ordered: qo, qty_received: qr, designation: `Pièce ${ref}` });
const doc = (lines: { reference: string | null; quantity: number | null }[]) => ({ supplier: "S", supplier_id: "s", or_number: "50927", lines });

describe("détail BL ↔ commande avant confirmation", () => {
  it("quantité égale au reliquat = conforme, aucun écart", () => {
    const r = compareDocToOrder(doc([{ reference: "ab-123", quantity: 2 }]), { part_order_lines: [line("AB123", 2)] });
    expect(r.rows[0]!.status).toBe("ok"); expect(r.gaps).toBe(0);
  });
  it("second BL : reliquat tient compte du déjà reçu", () => {
    const r = compareDocToOrder(doc([{ reference: "AB123", quantity: 1 }]), { part_order_lines: [line("AB123", 4, 3)] });
    expect(r.rows[0]).toMatchObject({ remaining: 1, qty_already: 3, status: "ok" });
  });
  it("partielle, excédent, hors commande, non livrée", () => {
    const r = compareDocToOrder(doc([{ reference: "A1111", quantity: 1 }, { reference: "B2222", quantity: 5 }, { reference: "Z9999", quantity: 1 }]),
      { part_order_lines: [line("A1111", 3), line("B2222", 2), line("C3333", 1)] });
    const st = Object.fromEntries(r.rows.map((x) => [x.reference, x.status]));
    expect(st).toEqual({ A1111: "partial", B2222: "over", Z9999: "not_ordered", C3333: "not_in_doc" });
    expect(r.gaps).toBe(4);
  });
  it("ligne déjà soldée non proposée en reliquat ; doublons BL agrégés", () => {
    const r = compareDocToOrder(doc([{ reference: "A1111", quantity: 1 }, { reference: "A1111", quantity: 1 }]), { part_order_lines: [line("A1111", 2), line("D4444", 1, 1)] });
    expect(r.rows).toHaveLength(1); expect(r.rows[0]).toMatchObject({ qty_doc: 2, status: "ok" });
  });
  it("quantité illisible = à vérifier", () => {
    expect(compareDocToOrder(doc([{ reference: "A1111", quantity: null }]), { part_order_lines: [line("A1111", 2)] }).rows[0]!.status).toBe("qty_unknown");
  });
  it("deux candidats équivalents = choix manuel imposé (aucune certaine)", () => {
    const o = (id: string) => ({ id, site_id: "x", status: "ordered", supplier_id: "s", plate: null, supplier_order_ref: null, created_at: "2026-10-01", repair_orders: { or_number: "50927" }, part_order_lines: [line("A1111", 1)] });
    const s = receptionSuggestions(doc([{ reference: "A1111", quantity: 1 }]), [o("1"), o("2")], "x");
    expect(s.hasExact).toBe(false); expect(s.ambiguous).toBe(true);
  });
  it("autre site jamais proposé", () => {
    const o = { id: "1", site_id: "autre", status: "ordered", supplier_id: "s", plate: null, supplier_order_ref: null, repair_orders: { or_number: "50927" }, part_order_lines: [line("A1111", 1)] };
    const s = receptionSuggestions(doc([{ reference: "A1111", quantity: 1 }]), [o], "x");
    expect(s.certain.length + s.probable.length).toBe(0);
  });
});
