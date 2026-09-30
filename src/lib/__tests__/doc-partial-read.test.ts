import { describe, expect, it } from "vitest";
import { purchaseRules } from "@/lib/doc-rules";
import { normalizePurchaseExtract } from "@/lib/purchase-extract";
import { resolveSupplier, supplierAliases, withAlias } from "@/lib/supplier-identify";
import { matchSupplier, receptionSuggestions, searchPendingOrders, similarDesignation, supplierOpenOrders } from "@/lib/parts-site";

// Couche texte réelle (pdfjs, regroupement par ligne comme localDocText) de RETRO.PDF.
const RETRO = `OSKARBI AUTO SL
 ES B75149419
 Antxotxipi 9, Pol. Ind. ZAISA III
 20305 - IRUN (Gipuzkoa)
 Télf.: 0034 943 34 44 68
 FACTURE # 500732612
 COMMANDE WEB # 2883444
 Date   Paiement   Langue
 25/09/2026   SEPA   fr
 Adresse d'expédition  -   Adresse de facturation
 Monsieur Damien DIGOIN  DAMIEN DIGOIN AUTOMOBILE
 27 Rue Eugène Leroy  FR50910746916
 Quantité   Cod. Article   Designation   Prix Unitaire   Prix H.T.   % T.V.A   T.V.A   Prix Total
 1   562044E   Rétroviseur électrique gauche, asphérique, chauffant (5 broches)  33,04   33,04   0,00   0,00   33,04
Sous-total H.T.   33,04 EUR
 Frais de port et de emballage H.T.   7,45 EUR
 Total H.T.   40,49 EUR
 T.V.A   0,00 EUR
 Total   40,49 EUR`;

const site = "s1";
const order = (id: string, o: Partial<Record<string, unknown>> = {}) => ({
  id, status: "ordered", site_id: site, supplier_id: "pad", plate: null, supplier_order_ref: null, created_at: "2026-09-25T10:00:00Z",
  suppliers: { name: "PIECE AUTO DISCOUNT" }, repair_orders: null, part_order_lines: [], ...o,
}) as never;

describe("lecture partielle d'un document sans OR ni immat (RETRO.PDF)", () => {
  const x = normalizePurchaseExtract(purchaseRules(RETRO));
  it("fournisseur, facture, commande web, date, ligne, port, totaux lus sans IA", () => {
    expect(x.supplier).toBe("OSKARBI AUTO SL");
    expect(x.supplier_info?.vat_number).toBe("ESB75149419");
    expect(x.invoice_number).toBe("500732612");
    expect(x.order_reference).toBe("2883444");
    expect(x.document_date).toBe("2026-09-25");
    expect(x.lines).toHaveLength(1);
    expect(x.lines![0]).toMatchObject({ reference: "562044E", quantity: 1, unit_price: 33.04, amount: 33.04 });
    expect(x.lines![0]!.label).toContain("Rétroviseur électrique gauche");
    expect(x.shipping_ht).toBe(7.45);
    expect(x.total_ht).toBe(40.49);
    expect(x.total_ttc).toBe(40.49);
    expect(x.plate).toBeNull();
  });
  it("mise en page « Réf Désignation Qté PU Montant » toujours lue", () => {
    const f = purchaseRules("FAURIE AUTO SARLAT SAS\nBON DE LIVRAISON 914776\n7701208183 FILTRE A HUILE 2 8,50 17,00");
    expect((f["lines"] as unknown[]).length).toBe(1);
  });
});

describe("enseigne / alias fournisseur", () => {
  const S = [{ id: "pad", name: "PIECE AUTO DISCOUNT", notes: "Alias : OSKARBI AUTO SL\nTVA intracom : ESB75149419" }, { id: "f", name: "FAURIE AUTO SARLAT", notes: null }];
  it("raison sociale déclarée en alias => même fiche", () => {
    expect(supplierAliases(S[0]!.notes)).toEqual(["OSKARBI AUTO SL"]);
    const r = resolveSupplier("OSKARBI AUTO SL", S);
    expect(r.kind === "found" && r.supplier.id).toBe("pad");
    expect(matchSupplier("Oskarbi Auto S.L.", S)?.id).toBe("pad");
  });
  it("identifiant fiscal lu => fiche portant cet identifiant", () => {
    const r = resolveSupplier("NOM INCONNU", S, ["ES B75149419"]);
    expect(r.kind === "found" && r.supplier.id).toBe("pad");
  });
  it("mémorisation d'alias idempotente", () => {
    const n = withAlias("SIRET : 1", "Oskarbi auto sl");
    expect(n).toContain("Alias : OSKARBI AUTO SL");
    expect(withAlias(n, "OSKARBI AUTO SL")).toBe(n);
  });
});

describe("rapprochement par priorités", () => {
  const doc = { supplier: "OSKARBI AUTO SL", supplier_id: "pad", order_reference: "2883444", ref_candidates: ["500732612", "2883444"], invoice_number: "500732612", lines: [{ reference: "562044E", quantity: 1, label: "Rétroviseur électrique gauche, asphérique, chauffant", unit_price: 33.04 }] };
  const line = (ref: string | null, designation: string) => ({ physical_reference: ref, designation, line_kind: "part", status: "ordered", qty_ordered: 1, qty_received: 0, expected_unit_cost_ht: 33 });
  it("n° commande exact + réf pièce lisible non commune => zéro candidat (réf exacte obligatoire)", () => {
    const s = receptionSuggestions(doc, [order("a", { supplier_order_ref: "2883444" }), order("b")], site);
    expect(s.hasExact).toBe(false);
    expect(s.certain).toEqual([]);
    expect(s.probable).toEqual([]);
  });
  it("n° commande exact + aucune référence lisible => candidat à confirmer", () => {
    const s = receptionSuggestions({ ...doc, lines: [{ reference: null, label: "illisible", quantity: 1, unit_price: null }] }, [order("a", { supplier_order_ref: "2883444" })], site);
    expect(s.probable.length + s.certain.length).toBeGreaterThan(0);
  });
  it("fournisseur + référence => probable avec raison", () => {
    const s = receptionSuggestions({ ...doc, order_reference: null, ref_candidates: [] }, [order("a", { part_order_lines: [line("562044E", "Rétro")] })], site);
    expect(s.probable[0]!.reasons.join(" ")).toContain("réf 562044E");
  });
  it("désignation proche seule (sans référence) => jamais de correspondance probable", () => {
    const s = receptionSuggestions({ ...doc, order_reference: null, ref_candidates: [] }, [order("a", { part_order_lines: [line(null, "Rétroviseur électrique gauche")] })], site);
    expect(s.probable).toEqual([]);
    expect(similarDesignation("Rétroviseur gauche électrique", "Rétroviseur droit électrique")).toBe(false);
  });
  it("deux commandes identiques fournisseur+référence => ambiguïté, confirmation", () => {
    const s = receptionSuggestions({ ...doc, order_reference: null, ref_candidates: [] }, [order("a", { part_order_lines: [line("562044E", "Rétro")] }), order("b", { part_order_lines: [line("562044E", "Rétro")] })], site);
    expect(s.hasExact).toBe(false);
    expect(s.ambiguous).toBe(true);
  });
  it("aucun indice : commandes ouvertes du fournisseur proposées (jamais automatiques)", () => {
    const d = { ...doc, order_reference: null, ref_candidates: [], invoice_number: null, lines: [] };
    expect(receptionSuggestions(d, [order("a")], site).probable).toHaveLength(0);
    expect(supplierOpenOrders(d, [order("a"), order("z", { supplier_id: "x", suppliers: { name: "AUTRE" } })], site).map((m) => (m.order as { id: string }).id)).toEqual(["a"]);
  });
  it("recherche manuelle globale même sans fournisseur reconnu", () => {
    const list = [order("a", { supplier_order_ref: "2883444" }), order("b", { part_order_lines: [line("562044E", "Rétroviseur")] })];
    expect(searchPendingOrders(list, "", site, 20).length).toBe(2);
    expect(searchPendingOrders(list, "2883444", site, 20).map((o) => (o as { id: string }).id)).toEqual(["a"]);
    expect(searchPendingOrders(list, "retroviseur", site, 20).map((o) => (o as { id: string }).id)).toEqual(["b"]);
  });
});
