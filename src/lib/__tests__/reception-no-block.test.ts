import { describe, expect, it } from "vitest";
import { receptionSuggestions, searchPendingOrders, simplifiedOrderMeta } from "@/lib/parts-site";


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

describe("recherche manuelle : toutes les commandes non soldées du site", () => {
  const simp = o({ id: "simp", comment: "PNEUS AV MICHELIN 4S", created_by_name: "Frederic TEIXEIRA", created_at: "2026-09-28T07:37:42Z" });
  const detailed = o({ id: "det", order_mode: "detailed", created_at: "2026-09-28T08:30:00Z" });
  const done = o({ id: "done", order_mode: "detailed", status: "received", created_at: "2026-09-28T09:00:00Z" });
  const list = [detailed, done, simp];
  const ids = (q: string) => searchPendingOrders(list, q, "cas").map((x) => (x as { id: string }).id);
  it("détaillées et simplifiées listées, soldées exclues, récentes d'abord", () => {
    expect(ids("")).toEqual(["det", "simp"]);
    expect(ids("Frederic")).toEqual(["simp"]);
  });
  it("la commande détaillée reste candidate au rapprochement automatique", () => {
    const detailedPlate = o({ id: "det2", order_mode: "detailed", plate: "HG-732-GH" });
    const r = receptionSuggestions({ supplier: "FAURIE", plate: "HG732GH" }, [detailedPlate], "cas");
    expect(r.certain.map((m) => (m.order as { id: string }).id)).toEqual(["det2"]);
  });
});

describe("rapprochement sans OR ni immat (ORLEANS SUD AUTO / 16533)", () => {
  const line = (ref: string) => [{ physical_reference: ref, designation: "Optique avant principal droit", line_kind: "part", status: "ordered", qty_ordered: 1, qty_received: 0 }];
  const orleans = o({ id: "orl", order_mode: "detailed", site_id: "lal", supplier_id: "sOrl", supplier_order_ref: "32207746", plate: "dc354zh", suppliers: { name: "SOCIETE ORLEANS SUD AUTO" }, repair_orders: { or_number: "16533" }, part_order_lines: line("133378273"), created_at: "2026-09-28T12:17:21Z" });
  const noise = o({ id: "noise", order_mode: "detailed", site_id: "lal", part_order_lines: [{ ...line("7701208174")[0]!, designation: "Filtre à huile" }], created_at: "2026-09-29T08:00:00Z" });
  const facture = { supplier: null, order_reference: "226090324", invoice_number: "626090510", ref_candidates: ["32207746", "226090324", "626090510"], lines: [{ reference: "133378273", quantity: 1 }] };
  it("facture : fournisseur non lu, Transaction 32207746 => commande certaine en tête", () => {
    const r = receptionSuggestions(facture, [noise, orleans], "lal");
    expect(r.certain.map((m) => (m.order as { id: string }).id)).toEqual(["orl"]);
    expect(r.certain[0]!.reasons.join(" ")).toContain("32207746");
  });
  it("sans aucun n° lisible : la réf 133378273 suffit pour une correspondance probable", () => {
    const r = receptionSuggestions({ supplier: null, lines: [{ reference: "133378273", quantity: 1 }] }, [noise, orleans], "lal");
    expect(r.hasExact).toBe(false);
    expect((r.probable[0]!.order as { id: string }).id).toBe("orl");
  });
  it("recherche manuelle : la commande ORLEANS apparaît en tête sans saisie", () => {
    expect((searchPendingOrders([noise, orleans], "", "lal", 20, facture)[0] as unknown as { id: string }).id).toBe("orl");
    expect((searchPendingOrders([noise, orleans], "optique", "lal")[0] as unknown as { id: string }).id).toBe("orl");
  });
  it("non ambigu : fournisseur + référence + quantité => probable unique avec raisons", () => {
    const r = receptionSuggestions({ supplier_id: "sOrl", lines: [{ reference: "133378273", quantity: 1 }] }, [noise, orleans], "lal");
    expect(r.probable).toHaveLength(1);
    expect(r.ambiguous).toBe(false);
    expect(r.probable[0]!.reasons).toEqual(["même fournisseur", "réf 133378273 + qté 1"]);
  });
  it("ambigu : deux commandes même fournisseur + même réf => confirmation demandée, jamais certaine", () => {
    const twin = { ...(orleans as object), id: "twin", supplier_order_ref: "99999999", created_at: "2026-09-27T10:00:00Z" } as never;
    const r = receptionSuggestions({ supplier_id: "sOrl", lines: [{ reference: "133378273", quantity: 1 }] }, [orleans, twin], "lal");
    expect(r.hasExact).toBe(false);
    expect(r.ambiguous).toBe(true);
    expect(r.probable).toHaveLength(2);
  });
});

describe("carte commande simplifiée : commentaire / créateur / heure", () => {
  it("simplifiée sans lignes mais avec commentaire : méta affichée, pas « Contenu non détaillé »", () => {
    const m = simplifiedOrderMeta(o({ comment: "PNEUS AV MICHELIN 4S", created_by_name: "Frederic TEIXEIRA", created_at: "2026-09-28T07:37:42Z" }));
    expect(m.hasMeta).toBe(true);
    expect(m.comment).toBe("PNEUS AV MICHELIN 4S");
    expect(m.createdBy).toBe("Frederic TEIXEIRA");
    expect(m.when).toContain("07:37");
  });
  it("commande détaillée : pas de bloc simplifié", () => {
    const m = simplifiedOrderMeta(o({ order_mode: "detailed", comment: "PNEUS AV MICHELIN 4S", created_by_name: "Frederic TEIXEIRA", created_at: "2026-09-28T07:37:42Z" }));
    expect(m.hasMeta).toBe(false);
  });
  it("simplifiée sans commentaire ni créateur : repli « Contenu non détaillé »", () => {
    expect(simplifiedOrderMeta(o({})).hasMeta).toBe(false);
    expect(simplifiedOrderMeta(o({ comment: "   " })).hasMeta).toBe(false);
  });
  it("simplifiée avec lignes : commentaire affiché en plus des lignes", () => {
    const line = [{ physical_reference: "7701208174", line_kind: "part", status: "ordered" }];
    const m = simplifiedOrderMeta(o({ comment: "4 pneus", part_order_lines: line }));
    expect(m.hasMeta).toBe(true);
    expect(m.comment).toBe("4 pneus");
  });
});

