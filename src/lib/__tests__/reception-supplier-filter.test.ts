import { describe, expect, it } from "vitest";
import { matchOrders, otherReadNumbers, receptionSuggestions, sameSupplier } from "@/lib/parts-site";
import { detectSupplier } from "@/lib/doc-rules";

const SARLAT = { id: "sar", name: "FAURIE AUTO SARLAT" };
const BERGERAC = { id: "ber", name: "RENAULT BERGERAC - GROUPE FAURIE" };

const order = (id: string, sup: { id: string; name: string }, or: string, ref: string, designation: string, pu: number, extra: Record<string, unknown> = {}) => ({
  id, site_id: "s1", status: "ordered", supplier_id: sup.id, suppliers: { name: sup.name }, plate: null,
  supplier_order_ref: null as string | null, created_at: "2026-09-29T10:00:00Z",
  repair_orders: { or_number: or },
  part_order_lines: [{ physical_reference: ref, line_kind: "part", status: "ordered", qty_ordered: 1, qty_received: 0, designation, expected_unit_cost_ht: pu }],
  ...extra,
});

// BL papier FAURIE AUTO SARLAT 914971 (cas réel 29/09/2026).
const BL = {
  supplier: "FAURIE AUTO SARLAT", supplier_id: "sar", or_number: "50927", plate: null,
  order_reference: "45978608", delivery_note_number: "914971", document_number: "914971",
  ref_candidates: ["45978608", "914971", "326907"],
  lines: [{ reference: "8550504590", label: "MOTRIO filtre à huile", quantity: 1, unit_price: 8.17 }],
};

describe("rapprochement réception — fournisseur bloquant", () => {
  const bergFilter = order("b1", BERGERAC, "50921", "8100014522", "Filtre à huile", 9.5);
  const good = order("g1", SARLAT, "50927", "8550504590", "Filtre à huile MOTRIO", 8.18, { supplier_order_ref: "45978604" });

  it("fournisseur différent = zéro candidat", () => {
    expect(matchOrders(BL, [bergFilter], "s1")).toHaveLength(0);
  });
  it("même groupe, agence différente = pas le même fournisseur", () => {
    expect(sameSupplier({ supplier: "FAURIE AUTO SARLAT" }, { supplier_id: null, suppliers: { name: BERGERAC.name } })).toBe(false);
    expect(matchOrders({ ...BL, supplier_id: null }, [bergFilter], "s1")).toHaveLength(0);
  });
  it("OR exact + réf exacte mais fournisseur différent = zéro candidat", () => {
    const wrong = order("b2", BERGERAC, "50927", "8550504590", "Filtre", 8.17);
    expect(matchOrders(BL, [wrong], "s1")).toHaveLength(0);
  });
  it("même fournisseur + OR exact + réf exacte = candidat, écart centime signalé, écart n° commande affiché", () => {
    const r = receptionSuggestions(BL, [bergFilter, good], "s1");
    const all = [...r.certain, ...r.probable];
    expect(all.map((m) => m.order.id)).toEqual(["g1"]);
    const why = all[0]!.reasons.join(" | ");
    expect(why).toContain("même fournisseur");
    expect(why).toContain("OR/repère 50927 exact");
    expect(why).toContain("réf 8550504590 exacte");
    expect(why).toContain("arrondi");
    expect(why).toContain("écart n° commande : BL 45978608 / enregistrée 45978604");
  });
  it("sans OR mais même fournisseur + réf exacte = candidat", () => {
    const noOr = { ...BL, or_number: null };
    const o = order("g2", SARLAT, "", "8550504590", "Filtre", 8.17, { repair_orders: null });
    expect(matchOrders(noOr, [o], "s1").map((m) => m.order.id)).toEqual(["g2"]);
  });
  it("désignation proche seule = aucun candidat probable", () => {
    const noOr = { ...BL, or_number: null };
    const o = order("g3", SARLAT, "", "8100014522", "Filtre à huile MOTRIO", 8.17, { repair_orders: null });
    expect(matchOrders(noOr, [o], "s1")).toHaveLength(0);
  });
  it("même fournisseur + OR exact + références lisibles toutes différentes = zéro candidat", () => {
    const o = order("g4", SARLAT, "50927", "8100014522", "Autre pièce", 12.3);
    expect(matchOrders(BL, [o], "s1")).toHaveLength(0);
  });
  it("même fournisseur + OR exact + aucune référence lisible = candidat à confirmer", () => {
    const noRefs = { ...BL, lines: [{ reference: null, label: "illisible", quantity: 1, unit_price: null }] };
    const o = order("g5", SARLAT, "50927", "8100014522", "Autre pièce", 12.3);
    const r = matchOrders(noRefs, [o], "s1");
    expect(r.map((m) => m.order.id)).toEqual(["g5"]);
    expect(r[0]!.level).toBe("probable");
  });
  it("fournisseur inconnu = aucun rapprochement", () => {
    expect(matchOrders({ ...BL, supplier: null, supplier_id: null }, [good], "s1")).toHaveLength(0);
  });
});

describe("repères OCR nettoyés", () => {
  it("n° commande / BL / réf pièce jamais listés comme n° lus", () => {
    expect(otherReadNumbers({ ...BL, ref_candidates: ["45978608", "914971", "8550504590"] })).toEqual([]);
  });
});

describe("détection fournisseur — agence du groupe", () => {
  const TEXT = `FAURIE AUTO SARLAT\n35 route de la Croix d'Espit\n24200 Sarlat-la-Canéda\nBON DE LIVRAISON 914971`;
  it("profil Bergerac appris écarté sur un BL Sarlat", () => {
    const hints = [{ name: BERGERAC.name, header_tokens: ["faurie", "auto", "route", "livraison"] }];
    expect(detectSupplier(TEXT, hints)).not.toBe(BERGERAC.name);
  });
  it("fiche Sarlat retrouvée par son nom", () => {
    expect(detectSupplier(TEXT, [{ name: BERGERAC.name, header_tokens: ["faurie", "auto", "route", "livraison"] }, { name: SARLAT.name }])).toBe(SARLAT.name);
  });
});
