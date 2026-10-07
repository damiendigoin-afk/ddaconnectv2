import { describe, expect, it } from "vitest";
import { purchaseRules, purchaseSuspects } from "@/lib/doc-rules";
import { matchOrders, receptionSuggestions } from "@/lib/parts-site";

// Texte reconstitué depuis la photo du BL CAZES 432364 (magasinier Adrien), pas l'OCR réel.
const BL = `CAZES
Concession Citroën Bergerac
BON DE LIVRAISON N° 432364
Date 06/10/2026
Client 03337
** BL 432364 DU 01/10/2026 ** Commande *dg893tk // berlingo
7401PZ PARE-CHOCS AVANT 1,00 746,96 23,00 575,16
Total HT 575,16
TVA 20 % 115,03
Net à payer 690,19`;
const CAZES = { id: "cazes", name: "CAZES" };
const order = (id: string, extra: Record<string, unknown> = {}) => ({
  id, status: "ordered", site_id: "cas", supplier_id: CAZES.id, suppliers: { name: "CAZES" }, plate: "DG-893-TK", supplier_order_ref: null,
  order_mode: "simplified", requested_or_number: null, repair_orders: null, part_order_lines: [], created_at: "2026-10-01T08:00:00Z", ...extra,
});
const doc = { supplier: "CAZES", supplier_id: CAZES.id, or_number: null, plate: "DG-893-TK", plate_or_numbers: [], lines: [{ reference: "7401PZ", quantity: 1, unit_price: 575.16 }] };

describe("BL CAZES 432364 — immat sans OR", () => {
  const r = purchaseRules(BL);
  it("plaque DG-893-TK, aucun OR inventé, berlingo/432364/03337 jamais OR", () => {
    expect(r["plate"]).toBe("DG-893-TK");
    expect(r["or_number"] ?? null).toBeNull();
    expect((r["or_numbers"] as string[] | undefined) ?? []).toEqual([]);
    expect(r["order_reference"] ?? null).toBeNull();
  });
  it("ligne 7401PZ / qté 1 / PA net 575,16 (ni 23 ni 746,96)", () => {
    const lines = r["lines"] as { reference: string; quantity: number; unit_price: number; label: string }[];
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ reference: "7401PZ", quantity: 1, unit_price: 575.16, label: "PARE-CHOCS AVANT" });
    expect(Math.round(746.96 * (1 - 0.23) * 100) / 100).toBe(575.16);
  });
  it("lecture complète => pas de vision ; lecture incomplète => vision demandée", () => {
    expect(r["_suspect"]).toBeUndefined();
    expect(purchaseSuspects(BL, { lines: [], plate: null, or_number: null })).toContain("or_number");
    expect(purchaseSuspects(BL, { lines: [{ reference: "7401PZ", label: "X", quantity: 1, unit_price: 23, amount: 23 }], plate: "DG-893-TK", or_number: null })).toContain("lines");
    expect(purchaseSuspects(BL, { lines: [{ reference: "7401PZ", label: "X", quantity: 1, unit_price: 746.96, amount: 746.96 }], plate: "DG-893-TK", or_number: null })).toContain("lines");
  });
  it("fournisseur + plaque + réf => commande détaillée certaine", () => {
    const det = order("d1", { order_mode: "detailed", part_order_lines: [{ physical_reference: "7401PZ", line_kind: "part", status: "ordered", qty_ordered: 1, qty_received: 0 }] });
    const s = receptionSuggestions(doc, [det], "cas");
    expect(s.certain.map((m) => m.order.id)).toEqual(["d1"]);
  });
  it("commande simplifiée fournisseur + plaque unique, sans OR => proposée", () => {
    const s = receptionSuggestions(doc, [order("o1")], "cas");
    expect(s.certain.map((m) => m.order.id)).toEqual(["o1"]);
  });
  it("deux candidates => ambiguïté, aucune auto-sélection", () => {
    const s = receptionSuggestions(doc, [order("o1"), order("o2")], "cas");
    expect(s.hasExact).toBe(false);
    expect(s.ambiguous).toBe(true);
  });
  it("autre plaque ou autre fournisseur => rien", () => {
    expect(matchOrders(doc, [order("o1", { plate: "AA-123-BB" })], "cas")).toEqual([]);
    expect(matchOrders(doc, [order("o1", { supplier_id: "x", suppliers: { name: "AUTODOC" } })], "cas")).toEqual([]);
  });
});
