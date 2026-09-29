import { describe, expect, it } from "vitest";
import { DOC_SPECS, missingFields, purchaseRules } from "@/lib/doc-rules";
import { normalizePurchaseExtract } from "@/lib/purchase-extract";
import { orderFormLinesFromDoc } from "@/lib/receipt-lines";
import { matchSupplier } from "@/lib/parts-site";

const RENAULT_PARTS = `Commande n°: 45965672
Date : 29/09/2026
Repère commande: DC354ZH or:16533
Plaque d'immatriculation: DC354ZH
Références
Réf : 214940005R
CONVERGENT D
Stock:
Entrepôt Central 1 pièce
Qté : 1
Prix client : 56,33 € HT
67,60 € TTC
Mode de livraisonLivraison à votre adresse :
41,12 € HT
En cours de traitement
Réf : 620727820R
COLLECTION ENJOLIVEUR BOUCLIER AV
Stock:
Entrepôt Central 1 pièce
Qté : 1
Prix client : 125,69 € HT
150,83 € TTC
Mode de livraisonLivraison à votre adresse :
109,35 € HT
En cours de traitement
Informations
Commandé par FREDERIC TEIXEIRA
N° client 25003497
Distributeur
RENAULT BERGERAC - GROUPE FAURIE
Compte de facturation 014120
Total : (2 articles)
Total HT : 150,47 €
TVA : 30,10 €
Total TTC : 180,57 €`;

describe("PDF Renault Parts 45965672 — structure texte réelle", () => {
  const raw = purchaseRules(RENAULT_PARTS, { suppliers: [{ name: "RENAULT BERGERAC - GROUPE FAURIE" }] });
  const x = normalizePurchaseExtract(raw);

  it("lit les ancres document et le fournisseur sur tout le PDF", () => {
    expect(x.supplier).toBe("RENAULT BERGERAC - GROUPE FAURIE");
    expect(matchSupplier(x.supplier, [{ id: "renault", name: "RENAULT BERGERAC - GROUPE FAURIE" }])?.id).toBe("renault");
    expect(x.order_reference).toBe("45965672");
    expect(x.order_date).toBe("2026-09-29");
    expect(x.or_number).toBe("16533");
    expect(x.plate).toBe("DC-354-ZH");
  });

  it("lit exactement deux blocs pièces et privilégie Prix client HT", () => {
    expect(x.lines).toEqual([
      expect.objectContaining({ reference: "214940005R", label: "CONVERGENT D", quantity: 1, unit_price: 56.33 }),
      expect.objectContaining({ reference: "620727820R", label: "COLLECTION ENJOLIVEUR BOUCLIER AV", quantity: 1, unit_price: 125.69 }),
    ]);
    expect(x.lines?.map((l) => l.unit_price)).not.toContain(41.12);
    expect(x.lines?.map((l) => l.unit_price)).not.toContain(109.35);
    expect(x.lines?.map((l) => l.unit_price)).not.toContain(67.6);
    expect(x.lines?.map((l) => l.unit_price)).not.toContain(150.83);
    expect(x.total_ht).toBe(150.47);
    expect(x.vat_amount).toBe(30.1);
    expect(x.total_ttc).toBe(180.57);
    expect(missingFields(DOC_SPECS.purchase, raw)).toEqual([]);
  });

  it("transmet réellement les valeurs aux lignes du formulaire", () => {
    expect(orderFormLinesFromDoc(x)).toEqual([
      { line_kind: "part", physical_reference: "214940005R", designation: "CONVERGENT D", qty_ordered: 1, expected_unit_cost_ht: 56.33 },
      { line_kind: "part", physical_reference: "620727820R", designation: "COLLECTION ENJOLIVEUR BOUCLIER AV", qty_ordered: 1, expected_unit_cost_ht: 125.69 },
    ]);
  });
});