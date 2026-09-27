import { describe, expect, it } from "vitest";
import { guessDocumentSite, matchOrders, matchSupplier, orderGaps, partsReadSite, partsWriteSite, pendingReceptionOrders, siteMismatch } from "@/lib/parts-site";

const sites = [
  { id: "cas", code: "castillon", name: "Castillon" },
  { id: "dda", code: "dda", name: "Damien Digoin Automobile" },
];
const order = (p: Partial<Parameters<typeof matchOrders>[1][number]>) => ({ id: "o", status: "ordered", site_id: "cas", supplier_id: "s1", plate: null, supplier_order_ref: null, suppliers: { name: "Autodistribution" }, repair_orders: null, part_order_lines: [], ...p });

describe("site actif global", () => {
  it("écrit sur le site actif, jamais sur l'autre", () => {
    expect(partsWriteSite("dda", false, "cas")).toBe("dda");
    expect(partsWriteSite("groupe", true, "cas")).toBe("cas");
    expect(partsWriteSite("groupe", true, null)).toBeNull();
  });
  it("lecture : site actif ou groupe", () => {
    expect(partsReadSite("cas", false)).toBe("cas");
    expect(partsReadSite("groupe", true)).toBeNull();
  });
  it("détecte un document d'un autre site sans basculer", () => {
    const s = guessDocumentSite("Livré à : Garage DDA - 24150 Lalinde", sites);
    expect(s).toBe("dda");
    expect(siteMismatch(s, "cas")).toBe(true);
    expect(guessDocumentSite("Garage inconnu", sites)).toBeNull();
    expect(guessDocumentSite("Lalinde et Castillon", sites)).toBeNull();
  });
});

describe("commandes et réception", () => {
  it("exclut les commandes totalement reçues ou annulées de l'attente", () => {
    const r = pendingReceptionOrders([{ status: "ordered" }, { status: "partial" }, { status: "received" }, { status: "cancelled" }]);
    expect(r.map((o) => o.status)).toEqual(["ordered", "partial"]);
  });
  it("rapproche un BL par OR, immat, référence et fournisseur, sur le seul site actif", () => {
    const orders = [
      order({ id: "a", plate: "FT-346-QS", repair_orders: { or_number: "12345" }, part_order_lines: [{ physical_reference: "7701 208 174", line_kind: "part", status: "ordered" }] }),
      order({ id: "b", site_id: "dda", plate: "FT-346-QS" }),
      order({ id: "c", status: "received", plate: "FT-346-QS" }),
    ];
    const m = matchOrders({ supplier: "AUTODISTRIBUTION SUD", plate: "ft346qs", or_number: "OR 12345", lines: [{ reference: "7701208174" }] }, orders, "cas");
    expect(m.map((x) => x.order.id)).toEqual(["a"]);
    expect(m[0]!.level).toBe("certain");
  });
  it("aucune correspondance sans indice", () => {
    expect(matchOrders({ supplier: "Autre" }, [order({ suppliers: { name: "Bosch" } })], "cas")).toEqual([]);
  });
  it("reconnaît un fournisseur connu seulement si unique", () => {
    const list = [{ id: "1", name: "Autodistribution" }, { id: "2", name: "Bosch" }];
    expect(matchSupplier("AUTODISTRIBUTION SA", list)?.id).toBe("1");
    expect(matchSupplier("Inconnu", list)).toBeNull();
  });
  it("ne bloque jamais : les manques partent en régularisation", () => {
    expect(orderGaps({ supplier_id: null, hasDocument: true, lines: 0, repair_order_id: null, plate: null, destination: "or" })).toEqual(["commande_sans_fournisseur", "destination_inconnue", "reference_a_completer"]);
    expect(orderGaps({ supplier_id: "s", hasDocument: false, lines: 0, repair_order_id: null, plate: "AB-123-CD", destination: "or" })).toEqual([]);
  });
});
