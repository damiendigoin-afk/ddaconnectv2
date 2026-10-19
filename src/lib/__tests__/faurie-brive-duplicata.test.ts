/**
 * Fixture « duplicata facture » d'un établissement Faurie (Brive). Les numéros ne sont que des données de test :
 * aucune règle métier ne dépend de ce fournisseur ni de ces valeurs.
 */
import { describe, expect, it } from "vitest";
import { runDocPipeline, type PipelineDeps } from "../doc-pipeline";
import { normalizePurchaseExtract } from "../purchase-extract";
import { classifyLineKind, needsLinesRecheck, pickRecheck, reviewReasons, validatePurchase } from "../purchase-validate";
import { resolveSupplier } from "../supplier-identify";
import { matchSupplier, receptionSuggestions, searchPendingOrders, explainOrderMatch } from "../parts-site";
import { purchaseRules, labelledInvoice, documentDate } from "../doc-rules";

const VISION = {
  doc_kind: "facture",
  supplier: "FAURIE AXESS PREMIUM BRIVE",
  supplier_info: { address: "Rue Armand Sourie ZAC du Mazaud", postal_code: "19102", city: "BRIVE LA GAILLARDE CEDEX", phone: "05 55 87 96 64", siret: "963 200 951 00035", vat_number: "FR25963200951" },
  document_number: "02-5018641",
  invoice_number: "02-5018641",
  document_date: "2026-10-16",
  order_reference: "1019880",
  plate: "FJ-673-VB",
  plate_printed: true,
  secondary_refs: ["1019880"],
  lines: [
    { line_kind: "part", reference: "83A853651", variant_code: "MX3", label: "GRILLE", quantity: 1, gross_unit_price: 459.12, discount_pct: 25, amount: 344.34, unit_price: 344.34, vat_pct: 20 },
    { line_kind: "fee", reference: "PORT", label: "FRAIS DE PORT", quantity: 1, unit_price: 14, amount: 14, vat_pct: 20 },
  ],
  total_ht: 358.34,
  vat_amount: 71.67,
  total_ttc: 430.01,
};

const OCR_TEXT = `FAURIE AXESS PREMIUM BRIVE
Rue Armand Sourie
ZAC du Mazaud
19102 BRIVE LA GAILLARDE CEDEX
Date de paiement : 30/11/2026
Mode règlement : L.C.R.
DUPLICATA FACTURE N° 02-5018641 du 16/10/2026
Numéro d'ordre 1019880
** BL 1019880 DU 16/10/2026 **
PORT FRAIS DE PORT 14,00 1 14,00
Total HT 358,34`;

const SUPPLIERS = [
  { id: "sarlat", name: "FAURIE AUTO SARLAT", active: true, notes: null },
  { id: "oskarbi", name: "OSKARBI AUTO SL", active: true, notes: "Alias : PIECE AUTO DISCOUNT" },
];

describe("Faurie Brive — vision complète", () => {
  const x = normalizePurchaseExtract(VISION);
  it("n° facture, date du document, lignes pièce + frais, totaux cohérents", () => {
    expect(x.invoice_number).toBe("02-5018641");
    expect(x.document_date).toBe("2026-10-16");
    expect(x.plate).toBe("FJ-673-VB");
    expect(x.lines).toHaveLength(2);
    expect(x.lines![0]).toMatchObject({ reference: "83A853651", variant_code: "MX3", label: "GRILLE", quantity: 1, amount: 344.34, line_kind: "part" });
    expect(x.lines![1]).toMatchObject({ label: "FRAIS DE PORT", amount: 14, line_kind: "fee" });
    expect(validatePurchase(x).ok).toBe(true);
    expect(reviewReasons(x, { visionFailed: false })).toEqual([]);
  });
});

describe("numéro / date", () => {
  it("« 10/2026 » n'est jamais un n° de facture", () => {
    expect(normalizePurchaseExtract({ ...VISION, invoice_number: "10/2026", document_number: "10/2026" }).invoice_number).toBeNull();
  });
  it("règles : libellé « Duplicata facture N° X du » prioritaire, date de paiement exclue", () => {
    expect(labelledInvoice(OCR_TEXT)).toEqual({ number: "02-5018641", date: "2026-10-16" });
    expect(documentDate("Date de paiement : 30/11/2026\nLe 16/10/2026")).toBe("2026-10-16");
    const r = purchaseRules(OCR_TEXT);
    expect(r["invoice_number"]).toBe("02-5018641");
    expect(r["document_date"]).toBe("2026-10-16");
  });
});

describe("fournisseur : établissements distincts", () => {
  it("BRIVE ne se rattache jamais à SARLAT ; fiche absente => nouveau fournisseur au nom exact", () => {
    expect(resolveSupplier("FAURIE AXESS PREMIUM BRIVE", SUPPLIERS)).toEqual({ kind: "new", name: "FAURIE AXESS PREMIUM BRIVE" });
    expect(matchSupplier("FAURIE AXESS PREMIUM BRIVE", SUPPLIERS)).toBeNull();
  });
  it("« FAURIE » seul ne suffit jamais", () => {
    const group = [{ id: "g", name: "FAURIE", active: true, notes: null }];
    expect(resolveSupplier("FAURIE AXESS PREMIUM BRIVE", group).kind).not.toBe("found");
    expect(matchSupplier("FAURIE AXESS PREMIUM BRIVE", group)).toBeNull();
  });
  it("SIRET exact l'emporte sur le nom", () => {
    const list = [...SUPPLIERS, { id: "brive", name: "AXESS BRIVE", active: true, notes: "SIRET/SIREN : 96320095100035" }];
    const r = resolveSupplier("FAURIE AUTO SARLAT", list, ["963 200 951 00035"]);
    expect(r).toMatchObject({ kind: "found", supplier: { id: "brive" } });
  });
});

describe("contrôles bloquants / relecture", () => {
  const portOnly = normalizePurchaseExtract({ ...VISION, lines: [VISION.lines[1]!] });
  it("PORT seul pour un total 358,34 => échec, relecture demandée, lecture à vérifier", () => {
    expect(validatePurchase(portOnly).ok).toBe(false);
    expect(needsLinesRecheck(portOnly, false)).toBe(true);
    expect(reviewReasons(portOnly, { visionFailed: false })).toContain("Contrôles chiffrés en échec");
  });
  it("relecture incomplète rejetée => la lecture reste à vérifier", () => {
    const r = pickRecheck(portOnly, { lines: [VISION.lines[1]!], total_ht: 358.34, vat_amount: 71.67, total_ttc: 430.01 });
    expect(r.used).toBe(false);
  });
  it("relecture complète retenue", () => {
    const r = pickRecheck(portOnly, { lines: VISION.lines, total_ht: 358.34, vat_amount: 71.67, total_ttc: 430.01 });
    expect(r.used).toBe(true);
  });
  it("TVA/TTC lus sans total HT => relecture", () => {
    expect(needsLinesRecheck({ lines: VISION.lines, total_ht: null, vat_amount: 71.67, total_ttc: 430.01 }, false)).toBe(true);
  });
});

describe("pipeline photo : vision nulle => jamais de lecture règles seule fiable", () => {
  it("vision en échec : fournisseur et n° en forme de date des règles ignorés, visionFailed", async () => {
    const deps: PipelineDeps = {
      fallbackEnabled: async () => true,
      aiText: async () => { throw new Error("aucun repli texte attendu"); },
      aiVision: async () => null,
      logLocal: async () => {},
    };
    const r = await runDocPipeline({ kind: "purchase", text: OCR_TEXT, hasImage: true, media: "photo", visionFirst: true, ctx: { suppliers: [{ name: "FAURIE AUTO SARLAT" }] as never } }, deps);
    expect(r.visionFailed).toBe(true);
    expect(r.fields["supplier"]).toBeUndefined();
    expect(reviewReasons(normalizePurchaseExtract(r.fields), { visionFailed: true })[0]).toMatch(/Lecture IA impossible/);
  });
});

describe("rapprochement", () => {
  const order = (id: string, supplier_id: string, name: string, lines: { physical_reference: string; designation: string }[]) => ({
    id, status: "ordered", site_id: "s1", supplier_id, plate: supplier_id === "oskarbi" ? "AC-598-XM" : null, supplier_order_ref: null, created_at: "2026-10-10",
    suppliers: { name }, part_order_lines: lines.map((l) => ({ ...l, line_kind: "part", status: "ordered", qty_ordered: 1, qty_received: 0 })),
  });
  const osk = order("o1", "oskarbi", "OSKARBI AUTO SL", [{ physical_reference: "PORT", designation: "Frais de port et emballage" }]);
  const doc = { ...normalizePurchaseExtract(VISION), supplier_id: "brive" };
  it("document Faurie : aucune commande OSKARBI, même en recherchant « frais de port »", () => {
    expect(searchPendingOrders([osk], "frais de port", "s1", 20, doc)).toEqual([]);
    expect(searchPendingOrders([osk], "", "s1", 20, doc)).toEqual([]);
    expect(receptionSuggestions(doc, [osk], "s1").probable).toEqual([]);
  });
  it("ligne de frais exclue du rapprochement pièce", () => {
    expect(classifyLineKind({ reference: "PORT", label: "FRAIS DE PORT" })).toBe("fee");
    const same = order("o2", "brive", "AXESS BRIVE", [{ physical_reference: "PORT", designation: "Port" }]);
    expect(explainOrderMatch(doc, same).refMatch).toBe(false);
  });
  it("lecture à vérifier : aucune correspondance automatique", () => {
    const same = order("o3", "brive", "AXESS BRIVE", [{ physical_reference: "83A853651", designation: "GRILLE" }]);
    expect(receptionSuggestions({ ...doc, requires_review: true }, [same], "s1")).toMatchObject({ certain: [], probable: [] });
    expect(receptionSuggestions(doc, [same], "s1").certain.length + receptionSuggestions(doc, [same], "s1").probable.length).toBe(1);
  });
});
