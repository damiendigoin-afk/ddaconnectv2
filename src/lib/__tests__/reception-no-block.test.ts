import { describe, expect, it } from "vitest";
import { receptionSuggestions, searchPendingOrders } from "@/lib/parts-site";

const o = (p: Record<string, unknown>) => ({ id: "o", status: "ordered", site_id: "cas", supplier_id: "s1", plate: null, supplier_order_ref: null, requested_or_number: null, order_mode: "simplified", suppliers: { name: "FAURIE AUTO SARLAT" }, repair_orders: null, part_order_lines: [], ...p }) as never;

describe("réception jamais bloquée", () => {
  it("sans match : aucune suggestion, même fournisseur", () => {
    const r = receptionSuggestions({ supplier: "FAURIE AUTO SARLAT", plate: "HG-732-GH" }, [o({ id: "a" }), o({ id: "b" })], "cas");
    expect(r.hasExact).toBe(false);
    expect(r.certain).toEqual([]);
    expect(r.probable).toEqual([]);
  });
  it("match certain par plaque", () => {
    const r = receptionSuggestions({ supplier: "FAURIE", plate: "HG732GH" }, [o({ id: "a", plate: "HG-732-GH" }), o({ id: "b" })], "cas");
    expect(r.hasExact).toBe(true);
    expect(r.certain.map((m) => (m.order as { id: string }).id)).toEqual(["a"]);
  });
  it("plusieurs probables : au plus 3", () => {
    const line = [{ physical_reference: "7701208174", line_kind: "part", status: "ordered" }];
    const list = ["a", "b", "c", "d", "e"].map((id) => o({ id, part_order_lines: line }));
    const r = receptionSuggestions({ supplier: "FAURIE", lines: [{ reference: "7701208174" }] }, list, "cas");
    expect(r.hasExact).toBe(false);
    expect(r.probable.length).toBe(3);
  });
  it("recherche manuelle par n° commande, OR, immat, réf, fournisseur", () => {
    const list = [
      o({ id: "a", supplier_order_ref: "45834714" }),
      o({ id: "b", repair_orders: { or_number: "50413" } }),
      o({ id: "c", plate: "HG-732-GH" }),
      o({ id: "d", part_order_lines: [{ physical_reference: "77 01 208 174", line_kind: "part", status: "ordered" }] }),
      o({ id: "e", suppliers: { name: "AUTODOC SE" } }),
      o({ id: "f", status: "received", supplier_order_ref: "45834714" }),
    ];
    const ids = (q: string) => searchPendingOrders(list, q, "cas").map((x) => (x as { id: string }).id);
    expect(ids("45834714")).toEqual(["a"]);
    expect(ids("50413")).toEqual(["b"]);
    expect(ids("hg732gh")).toEqual(["c"]);
    expect(ids("7701208174")).toEqual(["d"]);
    expect(ids("autodoc")).toEqual(["e"]);
  });
});

describe("recherche manuelle : commentaire et créateur", () => {
  const simplified = o({ id: "simp", comment: "PNEUS AV MICHELIN 4S", created_by_name: "Frederic TEIXEIRA", requested_or_number: "50890", created_at: "2026-09-28T07:37:42Z", part_order_lines: [] });
  const other = o({ id: "other", comment: null, created_by_name: "Damien DIGOIN", created_at: "2026-09-27T10:00:00Z" });
  const list = [other, simplified];
  const ids = (q: string) => searchPendingOrders(list, q, "cas").map((x) => (x as { id: string }).id);
  it("recherche par commentaire « PNEUS AV MICHELIN 4S »", () => {
    expect(ids("pneu")).toEqual(["simp"]);
    expect(ids("Michelin")).toEqual(["simp"]);
    expect(ids("PNEUS AV MICHELIN 4S")).toEqual(["simp"]);
  });
  it("recherche par créateur « Frederic »", () => {
    expect(ids("Frederic")).toEqual(["simp"]);
    expect(ids("teixeira")).toEqual(["simp"]);
  });
  it("sans recherche : commandes simplifiées récentes en premier", () => {
    expect(ids("")).toEqual(["simp", "other"]);
  });
  it("le commentaire seul ne crée jamais de suggestion automatique", () => {
    const r = receptionSuggestions({ supplier: "FAURIE AUTO SARLAT", lines: [{ reference: "MICHELIN" }] }, [simplified], "cas");
    expect(r.hasExact).toBe(false);
    expect(r.certain).toEqual([]);
    expect(r.probable).toEqual([]);
  });
});

describe("recherche manuelle : commandes simplifiées uniquement", () => {
  const simp = o({ id: "simp", comment: "PNEUS AV MICHELIN 4S", created_by_name: "Frederic TEIXEIRA", created_at: "2026-09-28T07:37:42Z" });
  const detailed = o({ id: "det", order_mode: "detailed", comment: "PNEUS AV MICHELIN 4S", created_by_name: "Frederic TEIXEIRA", created_at: "2026-09-28T08:30:00Z" });
  const legacy = o({ id: "legacy", order_mode: null, created_at: "2026-09-28T09:00:00Z" });
  const list = [detailed, legacy, simp];
  const ids = (q: string) => searchPendingOrders(list, q, "cas").map((x) => (x as { id: string }).id);
  it("une commande detailed n'apparaît jamais, même à vide ou sur commentaire", () => {
    expect(ids("")).toEqual(["legacy", "simp"]);
    expect(ids("PNEUS AV MICHELIN 4S")).toEqual(["simp"]);
    expect(ids("Frederic")).toEqual(["simp"]);
  });
  it("order_mode inconnu/null est exclu de la recherche manuelle", () => {
    expect(ids("").includes("legacy")).toBe(false);
  });
  it("la commande détaillée reste candidate au rapprochement automatique", () => {
    const r = receptionSuggestions({ supplier: "FAURIE", plate: "HG732GH" }, [detailed], "cas");
    expect(r.certain.map((m) => (m.order as { id: string }).id)).toEqual(["det"]);
  });
});
