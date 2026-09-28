import { describe, expect, it } from "vitest";
import { docSupplierId, draftToSupplierRow, normSupplierName, resolveSupplier, supplierDraftFromExtract } from "@/lib/supplier-identify";
import { normalizePurchaseExtract } from "@/lib/purchase-extract";

const S = [
  { id: "f", name: "FAURIE AUTO SARLAT", active: true },
  { id: "a", name: "Auto Casse Thiébault", active: true },
  { id: "p1", name: "PARTS SUD", active: true },
  { id: "p2", name: "PARTS SUD OUEST", active: true },
];

describe("identification fournisseur", () => {
  it("normalise casse, accents, ponctuation, espaces", () => {
    expect(normSupplierName("  Auto-Casse   THIÉBAULT. ")).toBe("auto casse thiebault");
  });
  it("trouve une fiche existante malgré variantes", () => {
    const r = resolveSupplier("AUTO CASSE THIEBAULT", S);
    expect(r.kind === "found" && r.supplier.id).toBe("a");
    const r2 = resolveSupplier("Sarlat - Faurie Auto SAS", S);
    expect(r2.kind === "found" && r2.supplier.id).toBe("f");
  });
  it("fournisseur inconnu => nouveau, nom en majuscules", () => {
    expect(resolveSupplier("Surplus Industries", S)).toEqual({ kind: "new", name: "SURPLUS INDUSTRIES" });
  });
  it("plusieurs fiches proches => ambigu, pas de création", () => {
    expect(resolveSupplier("PARTS", S).kind).toBe("ambiguous");
  });
  it("nom absent/trop court => none", () => {
    expect(resolveSupplier(null, S).kind).toBe("none");
    expect(resolveSupplier("ab", S).kind).toBe("none");
  });
  it("brouillon prérempli avec les coordonnées lues, sans invention", () => {
    const x = normalizePurchaseExtract({ supplier: "Surplus Industries", supplier_info: { address: "12 rue du Port", postal_code: "24200", city: "Sarlat", phone: "05 53 00 00 00", email: "contact@surplus.fr", siret: "123 456 789 00012", vat_number: "fr 12 123456789", website: null } });
    const d = supplierDraftFromExtract(x);
    expect(d).toMatchObject({ name: "SURPLUS INDUSTRIES", address: "12 rue du Port", postal_code: "24200", city: "SARLAT", email: "contact@surplus.fr", siret: "12345678900012", vat_number: "FR12123456789", website: "" });
    const row = draftToSupplierRow(d);
    expect(row.notes).toContain("SIRET/SIREN : 12345678900012");
    expect(row.notes).toContain("TVA intracom : FR12123456789");
    expect(row.website).toBeNull();
  });
  it("e-mail/CP invalides ignorés", () => {
    const d = supplierDraftFromExtract({ supplier: "X Y Z", supplier_info: { email: "pas un mail", postal_code: "24" } });
    expect(d.email).toBe("");
    expect(d.postal_code).toBe("");
  });
  it("le rattachement explicite du document prime", () => {
    expect(docSupplierId({ supplier: "AUTO CASSE THIEBAULT", supplier_id: "f" }, S)).toBe("f");
    expect(docSupplierId({ supplier: "AUTO CASSE THIEBAULT" }, S)).toBe("a");
    expect(docSupplierId({ supplier: "SURPLUS INDUSTRIES" }, S)).toBeNull();
  });
});
