import { describe, expect, it } from "vitest";
import { purchaseRules, DOC_SPECS, missingFields } from "@/lib/doc-rules";
import { normalizePurchaseExtract } from "@/lib/purchase-extract";
import { orderFormInitialState, orderFormLinesFromDoc, orderLineContractDiagnostic } from "@/lib/receipt-lines";
import { initialOrderSupplier } from "@/lib/order-supplier";

// Texte PDF natif réel « pad meg3 COMMANDE 2887178.pdf » : chaque pièce sur 3 lignes.
export const PAD_REAL_NATIVE = `Règlement: En compte
COMMANDE 2887178
Date Montant Paiement Payée le Status
29/09/2026 119,22 € SEPA 29/09/2026 13:48:50 A traiter
Adresse d'expédition Adresse de facturation
DAMIEN DIGOIN AUTOMOBILE
Qté Cod. Article Designation Prix Unitaire Prix
1 557119W 24,51 24,51
Support pare-chocs avant droit
immat: dc354zh - or: 16533
1 5571208 Amortisseur de pare-chocs avant 19,70 19,70
immat: dc354zh - or: 16533
1 5571209 Support de grille 50,01 50,01
immat: dc354zh - or: 16533
Sous-total 94,22 €
Frais de port et de emballage 25,00 €
Total 119,22 €
Dont T.V.A 0,00 €
OSKARBI AUTO SL · ANTXOTXIPI 9, POL. IND. ZAISA III · 20305 - IRUN / ESPAGNE`;

describe.each([["texte natif réel", PAD_REAL_NATIVE], ["sans €", PAD_REAL_NATIVE.replace(/ €/g, "")]])("commande PAD 2887178 (%s)", (_n, text) => {
  const raw = purchaseRules(text);
  const x = normalizePurchaseExtract(JSON.parse(JSON.stringify(raw)));
  it("en-tête", () => {
    expect(x.supplier).toBe("OSKARBI AUTO SL");
    expect(x.order_reference).toBe("2887178");
    expect(x.order_date).toBe("2026-09-29");
    expect(x.or_number).toBe("16533");
    expect(x.plate).toBe("DC-354-ZH");
    expect(x.total_ttc).toBe(119.22);
    expect(x.vat_amount).toBe(0);
    expect(x.shipping_ht).toBe(25);
  });
  it("mapping formulaire : 3 pièces + frais", () => {
    expect(orderFormLinesFromDoc(x)).toEqual([
      { line_kind: "part", physical_reference: "557119W", designation: "Support pare-chocs avant droit", qty_ordered: 1, expected_unit_cost_ht: 24.51 },
      { line_kind: "part", physical_reference: "5571208", designation: "Amortisseur de pare-chocs avant", qty_ordered: 1, expected_unit_cost_ht: 19.7 },
      { line_kind: "part", physical_reference: "5571209", designation: "Support de grille", qty_ordered: 1, expected_unit_cost_ht: 50.01 },
      { line_kind: "fee", physical_reference: "", designation: "Frais de port et de emballage", qty_ordered: 1, expected_unit_cost_ht: 25 },
    ]);
  });
  it("lecture complète", () => expect(missingFields(DOC_SPECS.purchase, raw)).toEqual([]));
});

describe("contrat runtime réel vers le state du formulaire", () => {
  const runtimePayload = {
    supplier: "OSKARBI AUTO SL",
    supplier_id: "supplier-pad",
    order_reference: "2887178",
    order_date: "2026-09-29",
    or_number: "16533",
    plate: "DC-354-ZH",
    shipping_ht: 25,
    shipping_label: "Frais de port et de emballage",
    lines: [
      { line_kind: "part", physical_reference: "557119W", designation: "Support pare-chocs avant droit", qty_ordered: 1, expected_unit_cost_ht: 24.51 },
      { line_kind: "part", physical_reference: "5571208", designation: "Amortisseur de pare-chocs avant", qty_ordered: 1, expected_unit_cost_ht: 19.7 },
      { line_kind: "part", physical_reference: "5571209", designation: "Support de grille", qty_ordered: 1, expected_unit_cost_ht: 50.01 },
    ],
  };

  it("préserve un résultat déjà au format formulaire lors de la normalisation navigateur", () => {
    const normalized = normalizePurchaseExtract(runtimePayload);
    const state = orderFormInitialState(normalized, "2026-10-01");
    expect(state).toEqual({
      supplierOrderRef: "2887178",
      orderDate: "2026-09-29",
      dossier: "16533",
      plate: "DC-354-ZH",
      lines: [
        { line_kind: "part", physical_reference: "557119W", designation: "Support pare-chocs avant droit", qty_ordered: 1, expected_unit_cost_ht: 24.51 },
        { line_kind: "part", physical_reference: "5571208", designation: "Amortisseur de pare-chocs avant", qty_ordered: 1, expected_unit_cost_ht: 19.7 },
        { line_kind: "part", physical_reference: "5571209", designation: "Support de grille", qty_ordered: 1, expected_unit_cost_ht: 50.01 },
        { line_kind: "fee", physical_reference: "", designation: "Frais de port et de emballage", qty_ordered: 1, expected_unit_cost_ht: 25 },
      ],
    });
    expect(initialOrderSupplier(normalized, [{ id: "supplier-pad", name: "PIECE AUTO DISCOUNT", notes: "Alias : OSKARBI AUTO SL" }])).toBe("supplier-pad");
    expect(orderLineContractDiagnostic(runtimePayload, state.lines)).toMatchObject({ parsedCount: 3, mappedCount: 4, blankMappedCount: 0 });
  });

  it("détecte trois objets arrivés vides au formulaire", () => {
    const malformed = { lines: [{ line_kind: "part" as const }, { line_kind: "part" as const }, { line_kind: "part" as const }] };
    expect(orderLineContractDiagnostic(malformed, orderFormLinesFromDoc(malformed))).toMatchObject({ parsedCount: 3, mappedCount: 0, blankMappedCount: 0, availableKeys: ["line_kind"] });
  });

  it("préfère les alias remplis quand les clés canoniques sont présentes mais vides", () => {
    const mixed = {
      lines: runtimePayload.lines.map((line) => ({ reference: "", label: null, quantity: null, unit_price: null, ...line })),
      shipping_ht: 25,
    } as Parameters<typeof orderFormLinesFromDoc>[0];
    expect(orderFormLinesFromDoc(mixed).slice(0, 3)).toEqual(runtimePayload.lines);
  });
});
