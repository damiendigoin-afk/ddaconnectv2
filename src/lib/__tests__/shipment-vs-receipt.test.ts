import { describe, expect, it } from "vitest";
import { hasPendingShipment, lineShipDisplay, shipmentQtyFromDoc, shippedToReceive } from "@/lib/shipment-rules";
import { lineAnomalies, linesAfterOrderPick, receiptLinesFromDoc, receiptLinesFromOrder } from "@/lib/receipt-lines";
import { dispatchDocLines, multiShipmentPayloads, type MoOrder } from "@/lib/multi-order-reception";
import { orderLineAfterReceiptCancel, orderLineStatus } from "@/lib/parts-rules";

// Cas réel AUTODOC : BL/facture 130601813, commande 179829863, dossier 50888, ET-875-QJ, réf 2152010 ×1.
const line = { id: "ol1", line_kind: "part", physical_reference: "2152010", designation: "Pièce", qty_ordered: 1, qty_received: 0, qty_shipped: 0, expected_unit_cost_ht: 33.74, status: "ordered" };
const bl = [{ reference: "2152010", label: "Pièce", quantity: 1, unit_price: 33.74 }];

describe("expédition fournisseur ≠ réception physique", () => {
  it("BL rapproché : quantité du BL préremplie (rien n'est enregistré avant Réceptionner)", () => {
    const [l] = linesAfterOrderPick([line], bl, "or", true);
    expect(l).toMatchObject({ qty_ordered: 1, qty_already_received: 0, qty_received: 1, allocate_qty: 1 });
  });
  it("BL sans commande : quantité du document préremplie", () => {
    const [l] = receiptLinesFromDoc(bl);
    expect(l).toMatchObject({ qty_expected: 1, qty_received: 1 });
    expect(lineAnomalies(l!)).toEqual([]);
  });
  it("le document donne la quantité expédiée par ligne de commande", () => {
    expect(shipmentQtyFromDoc([line], bl)).toEqual([{ order_line_id: "ol1", qty: 1 }]);
  });
  it("après expédition : statut « Expédiée », qty_received inchangée, statut commande inchangé", () => {
    const shipped = { ...line, qty_shipped: 1 };
    expect(lineShipDisplay(shipped)).toBe("shipped");
    expect(shipped.qty_received).toBe(0);
    expect(orderLineStatus(1, shipped.qty_received)).toBe("ordered");
    expect(hasPendingShipment({ status: "ordered", part_order_lines: [shipped] })).toBe(true);
  });
  it("confirmation de réception : reliquat expédié proposé par défaut (1)", () => {
    const [l] = receiptLinesFromOrder([{ ...line, qty_shipped: 1 }], "or");
    expect(l).toMatchObject({ qty_shipped: 1, qty_received: 1, allocate_qty: 1 });
  });
  it("réception partielle puis reliquat expédié restant", () => {
    const l2 = { ...line, qty_ordered: 3, qty_shipped: 3, qty_received: 1, status: "partial" };
    expect(receiptLinesFromOrder([l2], "or")[0]!.qty_received).toBe(2);
    expect(shippedToReceive([l2])).toHaveLength(1);
  });
  it("réception physique sans document : flux historique inchangé (reliquat commandé)", () => {
    expect(receiptLinesFromOrder([line], "or")[0]!.qty_received).toBe(1);
  });
  it("annulation de réception : le reliquat redevient « Expédiée »", () => {
    const after = orderLineAfterReceiptCancel({ qty_ordered: 1, qty_received: 1, status: "received" }, 1);
    expect(lineShipDisplay({ ...line, qty_shipped: 1, ...after })).toBe("shipped");
  });
  it("tout reçu : statut Reçue, plus rien à confirmer", () => {
    const done = { ...line, qty_shipped: 1, qty_received: 1, status: "received" };
    expect(lineShipDisplay(done)).toBe("received");
    expect(hasPendingShipment({ status: "received", part_order_lines: [done] })).toBe(false);
  });
  it("BL multi-commandes : quantités du document = expédiées par commande", () => {
    const mk = (id: string, ref: string): MoOrder => ({ id, site_id: "s", supplier_id: "sup", status: "ordered", supplier_order_ref: id, requested_or_number: null, plate: null, repair_order_id: null, destination: "stock", repair_orders: null, part_order_lines: [{ id: `${id}-l`, line_kind: "part", physical_reference: ref, designation: null, qty_ordered: 2, qty_received: 0, expected_unit_cost_ht: null, status: "ordered", repair_order_id: null, requested_or_number: null }] } as unknown as MoOrder);
    const plan = dispatchDocLines({ supplier_id: "sup", lines: [{ reference: "AAA", quantity: 2 }, { reference: "BBB", quantity: 1 }] } as never, [mk("o1", "AAA"), mk("o2", "BBB")], "s");
    expect(multiShipmentPayloads(plan)).toEqual([
      { order_id: "o1", lines: [{ order_line_id: "o1-l", qty: 2 }] },
      { order_id: "o2", lines: [{ order_line_id: "o2-l", qty: 1 }] },
    ]);
  });
});
