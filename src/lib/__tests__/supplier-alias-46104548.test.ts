import { describe, expect, it } from "vitest";
import { autoSupplier, initialOrderSupplier } from "@/lib/order-supplier";
import { canonicalSupplierName } from "@/lib/supplier-aliases";
import { docSupplierId, resolveSupplier } from "@/lib/supplier-identify";
import { matchSupplier } from "@/lib/parts-site";
import { normalizePurchaseExtract } from "@/lib/purchase-extract";
import { purchaseRules } from "@/lib/doc-rules";
import { RENAULT_46104548_REAL } from "./fixtures/renault-46104548-real";

const SARLAT = "5d7cb954-be2a-4ee8-a70b-871a734fe7c7";
const BERGERAC = "fab8bce4-43c1-46a6-94bc-ccc423cf1eee";
const SUPS = [
  { id: "c", name: "SAS CASTILLON VEYSSIERE", active: true, notes: null },
  { id: SARLAT, name: "FAURIE AUTO SARLAT", active: true, notes: null },
  { id: BERGERAC, name: "RENAULT BERGERAC - GROUPE FAURIE", active: true, notes: "Alias : FAURIE AUTO BERGERAC" },
];

describe("Commande 46104548 — fournisseur sélectionné dans l'écran", () => {
  it.each(["RENAULT SARLAT - GROUPE FAURIE", "RENAULT SARLAT GROUPE FAURIE", "RENAULT SARLAT", "GROUPE FAURIE SARLAT", "FAURIE AUTO SARLAT"])("alias %s => FAURIE AUTO SARLAT", (n) => {
    expect(canonicalSupplierName(n)).toBe("FAURIE AUTO SARLAT");
    expect(matchSupplier(n, SUPS)?.id).toBe(SARLAT);
    const r = resolveSupplier(n, SUPS);
    expect(r.kind === "found" && r.supplier.id).toBe(SARLAT);
  });
  it("Bergerac jamais confondu", () => {
    expect(canonicalSupplierName("RENAULT BERGERAC - GROUPE FAURIE")).toBeNull();
    expect(matchSupplier("RENAULT BERGERAC - GROUPE FAURIE", SUPS)?.id).toBe(BERGERAC);
  });
  it("PDF réel -> extraction -> état initial + auto du formulaire = FAURIE AUTO SARLAT", () => {
    const x = normalizePurchaseExtract(purchaseRules(RENAULT_46104548_REAL) as never);
    expect(x.supplier).toBe("RENAULT SARLAT - GROUPE FAURIE");
    const init = initialOrderSupplier(x, SUPS);
    expect(init).toBe(SARLAT);
    expect(autoSupplier("", false, x.supplier, SUPS)).toBe(SARLAT);
    expect(docSupplierId(x, SUPS)).toBe(SARLAT);
  });
  it("supplier_id auto erroné (client garage) corrigé ; choix manuel jamais écrasé", () => {
    const x = { supplier: "RENAULT SARLAT - GROUPE FAURIE", supplier_id: "c" };
    expect(initialOrderSupplier(x, SUPS)).toBe(SARLAT);
    expect(docSupplierId(x, SUPS)).toBe(SARLAT);
    expect(autoSupplier("c", false, x.supplier, SUPS)).toBe(SARLAT);
    expect(autoSupplier(BERGERAC, true, x.supplier, SUPS)).toBe(BERGERAC);
  });
});
