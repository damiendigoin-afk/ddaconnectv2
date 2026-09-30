import { describe, expect, it } from "vitest";
import { detectSupplier, orNumbersFromText, purchaseRules } from "@/lib/doc-rules";
import { normalizePurchaseExtract } from "@/lib/purchase-extract";
import { orderFormLinesFromDoc } from "@/lib/receipt-lines";
import { matchSupplier } from "@/lib/parts-site";
import { resolveSupplier } from "@/lib/supplier-identify";

// Transcription de la capture « Détail de commande » du 29/09/2026 (Renault Sarlat).
const SARLAT = `Détail de commande
Date : 29/09/2026
Commande n°: 45954556
Client : GARAGE CASTILLON-VEYSSIERE
Repère commande50919
Réf : 8660004228
Jeu de mâchoires (frein à tambour)-MOTRIO
Stock:
Entrepôt Central 1 pièce
Qté : 1
Prix client : 116,76 € HT
140,11 € TTC
64,22 € HT
Réf : 8550511394
Plaquettes de frein-MOTRIO
Qté : 1
Prix client : 61,30 € HT
73,56 € TTC
30,65 € HT
Informations
Commandé par frederic TEIXEIRA
N° client 25003407
Distributeur
RENAULT SARLAT - GROUPE FAURIE
Compte de facturation 014001
Total HT : 94,87 €
TVA : 18,97 €
Total TTC : 113,84 €`;

const BERGERAC_HINT = [{ name: "RENAULT BERGERAC - GROUPE FAURIE", header_tokens: ["renault", "groupe", "faurie", "commande", "detail"] }];

describe("Commande Renault Sarlat 45954556", () => {
  const raw = purchaseRules(SARLAT, { suppliers: BERGERAC_HINT });
  const x = normalizePurchaseExtract(raw);

  it("le Distributeur imprimé prime sur le profil appris Bergerac", () => {
    expect(x.supplier).toBe("RENAULT SARLAT - GROUPE FAURIE");
  });
  it("jamais de fusion Sarlat/Bergerac sur le groupe commun", () => {
    expect(matchSupplier(x.supplier, [{ id: "b", name: "RENAULT BERGERAC - GROUPE FAURIE" }])).toBeNull();
    expect(resolveSupplier(x.supplier, [{ id: "b", name: "RENAULT BERGERAC - GROUPE FAURIE" }]).kind).toBe("new");
    expect(matchSupplier(x.supplier, [{ id: "b", name: "RENAULT BERGERAC - GROUPE FAURIE" }, { id: "s", name: "FAURIE AUTO SARLAT" }])?.id).toBe("s");
  });
  it("seul OR 50919, commande 45954556, aucune immat", () => {
    expect(x.or_number).toBe("50919");
    expect(x.or_numbers).toEqual(["50919"]);
    expect(x.order_reference).toBe("45954556");
    expect(x.plate).toBeNull();
  });
  it("PA net 64,22 / 30,65, pas le prix client, désignations propres", () => {
    expect(orderFormLinesFromDoc(x)).toEqual([
      { line_kind: "part", physical_reference: "8660004228", designation: "Jeu de mâchoires (frein à tambour)-MOTRIO", qty_ordered: 1, expected_unit_cost_ht: 64.22 },
      { line_kind: "part", physical_reference: "8550511394", designation: "Plaquettes de frein-MOTRIO", qty_ordered: 1, expected_unit_cost_ht: 30.65 },
    ]);
    expect(x.total_ht).toBe(94.87);
    expect(x.vat_amount).toBe(18.97);
    expect(x.total_ttc).toBe(113.84);
  });
  it("idempotent au second passage, même avec des OR parasites hérités", () => {
    const again = normalizePurchaseExtract({ ...x, or_numbers: ["50919", "866000", "855051"] });
    expect(again.or_numbers).toEqual(["50919"]);
    expect(again.or_number).toBe("50919");
    expect(again.lines).toEqual(x.lines);
    expect(normalizePurchaseExtract(again)).toEqual(again);
  });
  it("libellé « Prix net » explicite", () => {
    const y = normalizePurchaseExtract(purchaseRules(SARLAT.replace("\n64,22 € HT", "\nPrix net : 64,22 € HT").replace("\n30,65 € HT", "\nPrix net : 30,65 € HT")));
    expect(y.lines?.map((l) => l.unit_price)).toEqual([64.22, 30.65]);
  });
  it("montants HT incohérents avec le total => prix client conservé", () => {
    const y = normalizePurchaseExtract(purchaseRules(SARLAT.replace("Total HT : 94,87 €", "Total HT : 178,06 €")));
    expect(y.lines?.map((l) => l.unit_price)).toEqual([116.76, 61.3]);
  });
});

describe("Distributeur / références longues (générique)", () => {
  it("Distributeur sur la même ligne sans deux-points", () => {
    expect(detectSupplier("Informations\nDistributeur RENAULT SARLAT - GROUPE FAURIE\nTotal", BERGERAC_HINT)).toBe("RENAULT SARLAT - GROUPE FAURIE");
  });
  it("sans Distributeur, les profils appris restent utilisés", () => {
    expect(detectSupplier("Détail de commande RENAULT BERGERAC - GROUPE FAURIE", BERGERAC_HINT)).toBe("RENAULT BERGERAC - GROUPE FAURIE");
  });
  it("jamais de préfixe de référence longue comme OR", () => {
    expect(orNumbersFromText("Réf : 8660004228\nRéf : 8550511394")).toEqual([]);
    expect(orNumbersFromText("Réf : 866000.42")).toEqual([]);
  });
  it("vrais multi-OR conservés", () => {
    expect(orNumbersFromText("Référence : 16952 17072")).toEqual(["16952", "17072"]);
    expect(orNumbersFromText("Repères : 16952, 17072 et 17080")).toEqual(["16952", "17072", "17080"]);
  });
});
