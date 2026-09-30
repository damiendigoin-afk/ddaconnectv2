import { describe, expect, it } from "vitest";
import { dispatchDocLines, multiReceiptPayloads, orderRepere, payloadsToCreate, PRICE_GAP_LABEL, type MoOrder } from "@/lib/multi-order-reception";
import { matchOrders } from "@/lib/parts-site";

const SITE = "castillon";
const SARLAT = { id: "sup-sarlat", name: "FAURIE AUTO SARLAT" };
const BERGERAC = { id: "sup-berg", name: "RENAULT BERGERAC - GROUPE FAURIE" };
const line = (id: string, ref: string, qty: number, pu: number, rec = 0) => ({ id, line_kind: "part", status: rec ? "partial" : "pending", physical_reference: ref, designation: "pièce", qty_ordered: qty, qty_received: rec, expected_unit_cost_ht: pu });
const order = (id: string, ref: string, repere: string, lines: ReturnType<typeof line>[], sup = SARLAT, extra: Partial<MoOrder> = {}): MoOrder => ({
  id, status: "ordered", site_id: SITE, supplier_id: sup.id, suppliers: { name: sup.name }, plate: null, supplier_order_ref: ref, requested_or_number: repere, repair_order_id: null, repair_orders: null, created_at: "2026-09-29T08:00:00Z", part_order_lines: lines, ...extra,
});
const O1 = order("o1", "45958680", "50793", [line("l1", "8100163243", 2, 2.65)]);
const O2 = order("o2", "45969031", "50921", [line("l2", "8100014906", 1, 11.28), line("l3", "8100014522", 1, 8.34)]);
const BL = {
  supplier: "FAURIE AUTO SARLAT", supplier_id: SARLAT.id, delivery_note_number: "914963", order_reference: null,
  lines: [
    { reference: "8100163243", quantity: 2, label: "Agrafe", amount: 5.29, unit_price: 2.65 },
    { reference: "8100014906", quantity: 1, label: "Filtre", amount: 14.1, unit_price: 14.1 },
    { reference: "8100014522", quantity: 1, label: "Filtre à huile", amount: 10.42, unit_price: 10.42 },
  ],
};

describe("BL 914963 FAURIE AUTO SARLAT — deux commandes", () => {
  const plan = dispatchDocLines(BL, [O1, O2], SITE);
  it("retrouve 2 commandes et leurs repères, sans n° de commande sur le BL", () => {
    expect(plan.groups.map((g) => [g.order.supplier_order_ref, g.repere, g.lines.map((a) => `${a.line.reference}×${a.line.quantity}`)])).toEqual([
      ["45958680", "50793", ["8100163243×2"]],
      ["45969031", "50921", ["8100014906×1", "8100014522×1"]],
    ]);
    expect(plan.ambiguous).toEqual([]);
    expect(plan.unmatched).toEqual([]);
    expect(plan.complete).toBe(true);
  });
  it("écarts de prix signalés sans bloquer", () => {
    const gaps = plan.assigns.map((a) => a.priceGap);
    expect(gaps).toEqual([-0.01, 2.82, 2.08]);
    expect(plan.globalGap).toBe(4.89);
    expect(PRICE_GAP_LABEL).toBe("Écart de prix à contrôler — une remise de fin de mois peut l'expliquer.");
    expect(plan.assigns.every((a) => a.state === "matched")).toBe(true);
  });
  it("une réception par commande, même BL, repères de la commande", () => {
    const p = multiReceiptPayloads(plan, {});
    expect(p.map((x) => [x.order_id, x.requested_or_number, x.lines.map((l) => [l.order_line_id, l.qty_received])])).toEqual([
      ["o1", "50793", [["l1", 2]]],
      ["o2", "50921", [["l2", 1], ["l3", 1]]],
    ]);
    // Chaque ligne n'est reçue qu'une fois.
    const ids = p.flatMap((x) => x.lines.map((l) => l.order_line_id));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("idempotence : second clic / rechargement ne recrée rien", () => {
    const p = multiReceiptPayloads(plan, {});
    expect(payloadsToCreate(p, [])).toHaveLength(2);
    expect(payloadsToCreate(p, [{ order_id: "o1", status: "validated" }]).map((x) => x.order_id)).toEqual(["o2"]);
    expect(payloadsToCreate(p, [{ order_id: "o1", status: "validated" }, { order_id: "o2", status: "validated" }])).toEqual([]);
    // Réception annulée : peut être refaite.
    expect(payloadsToCreate(p, [{ order_id: "o1", status: "cancelled" }]).map((x) => x.order_id)).toEqual(["o1", "o2"]);
  });
  it("repère : requested_or_number, sinon OR DDA, sinon repère de ligne", () => {
    expect(orderRepere(O1)).toBe("50793");
    expect(orderRepere({ ...O1, requested_or_number: null, repair_orders: { or_number: "50800" } })).toBe("50800");
    expect(orderRepere({ ...O1, requested_or_number: null, part_order_lines: [{ ...line("x", "A", 1, 1), requested_or_number: "50111" }] })).toBe("50111");
  });
});

describe("filtre fournisseur toujours bloquant", () => {
  it("autre agence du groupe (Bergerac) = aucune commande", () => {
    const b1 = order("b1", "1", "50793", [line("bl1", "8100163243", 2, 2.65)], BERGERAC);
    const plan = dispatchDocLines(BL, [b1], SITE);
    expect(plan.groups).toEqual([]);
    expect(plan.unmatched).toHaveLength(3);
  });
  it("fournisseur inconnu = rien de rapproché", () => {
    const plan = dispatchDocLines({ lines: BL.lines }, [O1, O2], SITE);
    expect(plan.groups).toEqual([]);
    expect(plan.unmatched.every((a) => a.reason === "fournisseur à confirmer")).toBe(true);
  });
  it("autre site = ignoré", () => {
    expect(dispatchDocLines(BL, [{ ...O1, site_id: "dda" }, O2], SITE).groups.map((g) => g.order.id)).toEqual(["o2"]);
  });
  it("désignation seule jamais rapprochée", () => {
    const plan = dispatchDocLines({ ...BL, lines: [{ reference: "9999999999", quantity: 1, label: "pièce" }] }, [O1, O2], SITE);
    expect(plan.groups).toEqual([]);
    expect(plan.unmatched[0]!.reason).toMatch(/aucune commande/);
  });
});

describe("ambiguïtés, reliquats, lignes non rapprochées", () => {
  const O3 = order("o3", "45970000", "50999", [line("l4", "8100014522", 1, 8.34)]);
  it("même référence sur deux commandes compatibles = ambiguë, jamais forcée", () => {
    const plan = dispatchDocLines(BL, [O1, O2, O3], SITE);
    const a = plan.ambiguous.find((x) => x.line.reference === "8100014522")!;
    expect(a.candidates.map((c) => c.orderId).sort()).toEqual(["o2", "o3"]);
    expect(plan.complete).toBe(false);
    // Choix utilisateur ligne par ligne.
    const chosen = dispatchDocLines(BL, [O1, O2, O3], SITE, { 2: "o3" });
    expect(chosen.groups.map((g) => [g.order.id, g.lines.map((x) => x.line.reference)])).toEqual([["o1", ["8100163243"]], ["o2", ["8100014906"]], ["o3", ["8100014522"]]]);
    expect(chosen.complete).toBe(true);
  });
  it("reliquat : la quantité départage (une seule commande couvre la qté)", () => {
    const small = order("s", "A", "1", [line("s1", "8100163243", 1, 2.65)]);
    const plan = dispatchDocLines({ ...BL, lines: [BL.lines[0]!] }, [small, O1], SITE);
    expect(plan.groups.map((g) => g.order.id)).toEqual(["o1"]);
  });
  it("reliquat : partiellement reçue, reste 1 — qté 2 signalée au-dessus du reliquat", () => {
    const part = order("p", "A", "1", [line("p1", "8100163243", 2, 2.65, 1)], SARLAT, { status: "partial" });
    const plan = dispatchDocLines({ ...BL, lines: [BL.lines[0]!] }, [part], SITE);
    expect(plan.assigns[0]!.state).toBe("matched");
    expect(plan.assigns[0]!.qtyOverRemaining).toBe(true);
  });
  it("ligne déjà totalement reçue = non rapprochée (pas de double réception)", () => {
    const done = order("d", "A", "1", [{ ...line("d1", "8100163243", 2, 2.65, 2), status: "received" }], SARLAT, { status: "partial" });
    expect(dispatchDocLines({ ...BL, lines: [BL.lines[0]!] }, [done], SITE).unmatched).toHaveLength(1);
  });
  it("lignes non retrouvées conservées ; acceptées sans commande seulement après confirmation", () => {
    const bl = { ...BL, lines: [...BL.lines, { reference: "7700000001", quantity: 3, label: "Vis", amount: 3, unit_price: 1 }] };
    const plan = dispatchDocLines(bl, [O1, O2], SITE);
    expect(plan.unmatched.map((a) => a.line.reference)).toEqual(["7700000001"]);
    expect(plan.complete).toBe(false);
    expect(multiReceiptPayloads(plan, {}).some((p) => p.order_id === null)).toBe(false);
    const ok = dispatchDocLines(bl, [O1, O2], SITE, { 3: "none" });
    expect(ok.complete).toBe(true);
    const p = multiReceiptPayloads(ok, { 3: "none" });
    expect(p.find((x) => x.order_id === null)!.lines).toEqual([expect.objectContaining({ physical_reference: "7700000001", designation: "Vis", qty_received: 3, unit_cost: 1 })]);
    expect(payloadsToCreate(p, [{ order_id: null, status: "validated" }]).some((x) => x.order_id === null)).toBe(false);
  });
});

describe("règles publiées préservées", () => {
  it("sans référence lisible : suggestion fournisseur + OR toujours possible (matchOrders)", () => {
    const r = matchOrders({ supplier_id: SARLAT.id, or_number: "50921", lines: [] }, [O2 as never], SITE);
    expect(r.map((m) => m.order.id)).toEqual(["o2"]);
  });
  it("référence lisible différente : aucune commande même avec OR exact", () => {
    expect(matchOrders({ supplier_id: SARLAT.id, or_number: "50921", lines: [{ reference: "123456789" }] }, [O2 as never], SITE)).toEqual([]);
  });
});
