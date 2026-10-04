import { describe, expect, it } from "vitest";
import { purchaseRules, purchaseSuspects } from "@/lib/doc-rules";
import { matchOrders, receptionSuggestions } from "@/lib/parts-site";

const BL = `CAZES
BON DE LIVRAISON N° 432200
Date 01/10/2026
Client 03337
** BL 432112 DU 28/09/2026 ** Commande *gp747ta // tclass // 50912
A 420 420 62 00 JEU PCES PEXT GARNITURE FREIN 1 101,67 30 71,17
Total HT 71,17`;
const CAZES = { id: "cazes", name: "CAZES" };
const simple = (id: string, or: string | null, extra: Record<string, unknown> = {}) => ({
  id, status: "ordered", site_id: "cas", supplier_id: CAZES.id, suppliers: { name: "CAZES" }, plate: null, supplier_order_ref: null,
  order_mode: "simplified", requested_or_number: or, repair_orders: null, part_order_lines: [], created_at: "2026-09-28T08:00:00Z", ...extra,
});
const doc = { supplier: "CAZES", supplier_id: CAZES.id, or_number: "50912", lines: [{ reference: "A4204206200", quantity: 1, unit_price: 71.17 }] };

describe("BL CAZES 432112 — commande simplifiée OR 50912", () => {
  it("extrait 50912 comme repère OR, jamais le BL 432112 ni le client 03337", () => {
    const r = purchaseRules(BL);
    expect(r["or_number"]).toBe("50912");
    expect(r["or_numbers"]).not.toContain("432112");
    expect(r["or_numbers"]).not.toContain("03337");
    expect(r["order_reference"]).toBeNull();
  });
  it("fournisseur + OR suffit pour une commande simplifiée sans ligne : certaine", () => {
    const s = receptionSuggestions(doc, [simple("o1", "50912")], "cas");
    expect(s.hasExact).toBe(true);
    expect(s.certain.map((m) => m.order.id)).toEqual(["o1"]);
  });
  it("autre OR ou autre fournisseur : aucune proposition", () => {
    expect(matchOrders(doc, [simple("o1", "50913")], "cas")).toEqual([]);
    expect(matchOrders(doc, [simple("o1", "50912", { supplier_id: "x", suppliers: { name: "AUTODOC" } })], "cas")).toEqual([]);
  });
  it("deux commandes simplifiées ambiguës : candidates proposées, aucune choisie", () => {
    const s = receptionSuggestions(doc, [simple("o1", "50912"), simple("o2", "50912", { created_at: "2026-09-29T08:00:00Z" })], "cas");
    expect(s.hasExact).toBe(false);
    expect(s.probable.map((m) => m.order.id).sort()).toEqual(["o1", "o2"]);
    expect(s.ambiguous).toBe(true);
  });
  it("commande détaillée : OR exact mais référence différente = toujours écartée", () => {
    const det = simple("d1", "50912", { order_mode: "detailed", part_order_lines: [{ physical_reference: "7701208174", line_kind: "part", status: "ordered" }] });
    expect(matchOrders(doc, [det], "cas")).toEqual([]);
  });
});

const BL_PHOTO = `CAZES
BON DE LIVRAISON N° 432200
Date 01/10/2026
Client 03337
** BL 432112 DU 28/09/2026 ** Commande *gp747ta // tclass // 50912
A 420 420 62 00 JEU PCES PEXT GARNITURE FREIN 1 101,67 30,00 71,17
Total HT 71,17`;

describe("BL CAZES photo — immat + OR + ligne remisée", () => {
  it("extrait GP-747-TA et 50912, jamais 432112/03337, tclass ignoré", () => {
    const r = purchaseRules(BL_PHOTO);
    expect(r["plate"]).toBe("GP-747-TA");
    expect(r["or_number"]).toBe("50912");
    expect(r["or_numbers"]).toEqual(["50912"]);
    expect(r["order_reference"]).toBeNull();
  });
  it("ligne = A4204206200 / qté 1 / PA net 71,17 (ni 7117 ni 30,00)", () => {
    const lines = purchaseRules(BL_PHOTO)["lines"] as { reference: string; quantity: number; unit_price: number; label: string }[];
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ reference: "A4204206200", quantity: 1, unit_price: 71.17, label: "JEU PCES PEXT GARNITURE FREIN" });
  });
  it("lecture décalée (réf 7117, PU 30) ou annotation sans OR/immat => vision demandée", () => {
    expect(purchaseSuspects(BL_PHOTO, { lines: [{ reference: "7117", label: "X", quantity: 1, unit_price: 30, amount: 30 }], plate: "GP-747-TA", or_number: "50912" })).toContain("lines");
    expect(purchaseSuspects(BL_PHOTO, { lines: [], plate: null, or_number: null })).toContain("or_number");
    expect(purchaseRules(BL_PHOTO)["_suspect"]).toBeUndefined();
  });
  const docPlate = { supplier: "CAZES", supplier_id: CAZES.id, or_number: null, plate: "GP-747-TA", plate_or_numbers: ["50912"], lines: [{ reference: "A4204206200", quantity: 1, unit_price: 71.17 }] };
  it("fournisseur + immat (via OR du véhicule) unique, OR absent => proposition certaine", () => {
    const s = receptionSuggestions(docPlate, [simple("o1", "50912")], "cas");
    expect(s.certain.map((m) => m.order.id)).toEqual(["o1"]);
  });
  it("immat sans OR rattaché => aucune proposition", () => {
    expect(matchOrders({ ...docPlate, plate_or_numbers: [] }, [simple("o1", "50912")], "cas")).toEqual([]);
  });
  it("OR + immat => correspondance renforcée", () => {
    const [m] = matchOrders({ ...doc, plate: "GP-747-TA", plate_or_numbers: ["50912"] }, [simple("o1", "50912")], "cas");
    const [m0] = matchOrders(doc, [simple("o1", "50912")], "cas");
    expect(m!.score).toBeGreaterThan(m0!.score);
    expect(m!.reasons).toContain("OR + immat exacts");
  });
  it("plusieurs commandes plausibles par immat => ambiguïté", () => {
    const s = receptionSuggestions(docPlate, [simple("o1", "50912"), simple("o2", "50912")], "cas");
    expect(s.hasExact).toBe(false);
    expect(s.ambiguous).toBe(true);
  });
  it("fournisseur différent => aucune, détaillée réf différente => écartée même avec immat", () => {
    expect(matchOrders(docPlate, [simple("o1", "50912", { supplier_id: "x", suppliers: { name: "AUTODOC" } })], "cas")).toEqual([]);
    const det = simple("d1", "50912", { order_mode: "detailed", plate: "GP-747-TA", part_order_lines: [{ physical_reference: "7701208174", line_kind: "part", status: "ordered" }] });
    expect(matchOrders(docPlate, [det], "cas")).toEqual([]);
  });
});
