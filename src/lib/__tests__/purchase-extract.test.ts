import { describe, expect, it } from "vitest";

import { normalizePurchaseExtract } from "@/lib/purchase-extract";
import { guessDocumentSite, matchSupplier } from "@/lib/parts-site";
import { docSiteText } from "@/lib/purchase-doc";

// Réponse OCR type pour le bon de commande réel 0332b1a5… (Commande n° 45834714).
const ocr = {
  doc_kind: "commande",
  distributor: "RENAULT SARLAT - GROUPE FAURIE",
  document_number: "45834714",
  document_date: "2026-09-27",
  order_reference: "45834714",
  or_number: "Repère 50413",
  plate: "BL-859-FD",
  plate_printed: false,
  customer_or_site: "GARAGE CASTILLON-VEYSSIERE, ARGENTONESSE, 24220 CASTELS",
  lines: [
    { ref: "8100029957", designation: "Vanne EGR - PIERBURG 7.01782.07.0", qty: "1", unit_price: "229,39", client_price: 229.39, amount: "160,57", delay: "livré à votre R1 le 28 septembre avant 13:00" },
  ],
  total_ht: 160.57,
  vat_amount: 32.12,
  total_ttc: 192.69,
};

const sites = [
  { id: "cas", code: "castillon", name: "Castillon" },
  { id: "dda", code: "dda", name: "Damien Digoin Automobile" },
];
const suppliers = [
  { id: "s1", name: "FAURIE AUTO SARLAT" },
  { id: "s2", name: "AUTODISTRIBUTION" },
];

describe("bon de commande 45834714 (régression)", () => {
  const x = normalizePurchaseExtract(ocr);

  it("extrait fournisseur, commande, OR", () => {
    expect(x.supplier).toBe("RENAULT SARLAT - GROUPE FAURIE");
    expect(matchSupplier(x.supplier, suppliers)?.id).toBe("s1");
    expect(x.order_reference).toBe("45834714");
    expect(x.or_number).toBe("50413");
  });

  it("ligne pièce avec PA net et non le prix client", () => {
    expect(x.lines).toHaveLength(1);
    const l = x.lines![0]!;
    expect(l.reference).toBe("8100029957");
    expect(l.label).toBe("Vanne EGR - PIERBURG 7.01782.07.0");
    expect(l.quantity).toBe(1);
    expect(l.unit_price).toBe(160.57);
    expect(l.unit_price).not.toBe(229.39);
    expect(l.delay).toContain("28 septembre");
  });

  it("site Castillon et aucune plaque inventée", () => {
    expect(guessDocumentSite(docSiteText(x), sites as never)).toBe("cas");
    expect(x.plate).toBeNull();
  });

  it("fournisseur non trouvé : nom conservé, pas de match arbitraire", () => {
    expect(matchSupplier("RENAULT SARLAT - GROUPE FAURIE", [{ id: "z", name: "AUTODISTRIBUTION" }])).toBeNull();
    expect(x.supplier).toBeTruthy();
  });
});
