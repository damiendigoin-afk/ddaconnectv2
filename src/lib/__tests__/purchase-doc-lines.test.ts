import { describe, expect, it, vi } from "vitest";
import { purchaseRules } from "@/lib/doc-rules";
import { normalizePurchaseExtract } from "@/lib/purchase-extract";
import { RENAULT_46104548_REAL } from "./fixtures/renault-46104548-real";

vi.mock("@/lib/doc-text.browser", () => ({ localDocText: async () => RENAULT_46104548_REAL }));
vi.mock("@/lib/photo", () => ({ blobToDataUrl: async () => "data:application/pdf;base64,AAAA", compressImage: async () => null }));
vi.mock("@/lib/ocr.functions", () => ({
  ocrPurchaseDocument: async () => ({ ok: true, error: "", json: JSON.stringify(normalizePurchaseExtract(purchaseRules(RENAULT_46104548_REAL))) }),
}));

import { readPurchaseDoc } from "@/lib/purchase-doc";
import { hasUsableOrderLines } from "@/lib/receipt-lines";

describe("Import Renault 46104548 — pas de faux « Aucune ligne détectée »", () => {
  it("lecture complète => aucun avertissement, 2 lignes", async () => {
    const r = await readPurchaseDoc(new File(["x"], "52a95b53.pdf", { type: "application/pdf" }));
    expect(r.warning).toBeNull();
    expect(r.extracted.lines?.map((l) => [l.reference, l.label, l.quantity, l.unit_price])).toEqual([
      ["8660004937", "MOTRIO Filtre d'habitacle -Pol", 1, 11.64],
      ["8660003779", "MOTRIO Filtre à huile", 1, 6.77],
    ]);
  });
  it("lignes du formulaire lues sur leurs vraies clés", () => {
    expect(hasUsableOrderLines([{ line_kind: "part", physical_reference: "8660004937", designation: "", qty_ordered: 1, expected_unit_cost_ht: 11.64 }])).toBe(true);
    expect(hasUsableOrderLines([{ line_kind: "part", physical_reference: " ", designation: "", qty_ordered: 1, expected_unit_cost_ht: null }])).toBe(false);
    expect(hasUsableOrderLines([])).toBe(false);
  });
});
