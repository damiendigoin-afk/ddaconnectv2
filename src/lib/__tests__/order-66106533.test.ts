import { describe, expect, it } from "vitest";
import { purchaseRules } from "../doc-rules";
import { normalizePurchaseExtract } from "../purchase-extract";
import { orderFormLinesFromDoc } from "../receipt-lines";
import type { InvoiceExtract } from "../supplier-docs";

const TXT = `Commande N° 66106533
Commande du 01/10/2026
CASTILLON VEYSSIERE GGE
RENAULT ST CYPRIEN
24220 CASTELS
Tél: 0553292023
Email: contact@garagecastillon.fr N° Siret: 38200413300015
Total articles : 1 références
Montants (hors articles non référencé) : 13,72 € HT 16,46 € TTC
IMAGE EQUIPEMENTIER CARACT. ÉQUIPEMENTIER/DÉSIGNATION RÉFÉRENCE PRIX ACHAT € HT QTÉ MESS.
PURFLUX FILTRE D'HABITACLE A POLLEN AH340 13,72 € HT 1`;

describe("order_66106533.pdf (Castillon)", () => {
  it("règles : une ligne AH340", () => {
    const lines = purchaseRules(TXT)["lines"] as { reference: string; label: string; quantity: number; unit_price: number }[];
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ reference: "AH340", label: "FILTRE D'HABITACLE A POLLEN", quantity: 1, unit_price: 13.72 });
  });
  it("contrat formulaire : ligne préremplie", () => {
    const ex = normalizePurchaseExtract(purchaseRules(TXT)) as InvoiceExtract;
    const form = orderFormLinesFromDoc(ex) as unknown as Record<string, unknown>[];
    const part = form.filter((l) => l["physical_reference"] === "AH340");
    expect(part).toHaveLength(1);
    expect(JSON.stringify(part[0])).toContain("FILTRE D'HABITACLE A POLLEN");
    expect(JSON.stringify(part[0])).toMatch(/13[.,]72/);
  });
});
