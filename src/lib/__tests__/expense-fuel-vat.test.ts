import { describe, expect, it } from "vitest";
import { expenseAmountRows } from "../expense-pdf";
import { recoverableFuelVat } from "../expenses";

describe("TVA récupérable carburant (80 %)", () => {
  it("calcul arrondi à 2 décimales", () => {
    expect(recoverableFuelVat("carburant", 20)).toBe(16);
    expect(recoverableFuelVat("carburant", 11.21)).toBe(8.97);
    expect(recoverableFuelVat("repas", 20)).toBeNull();
    expect(recoverableFuelVat("carburant", null)).toBeNull();
  });
  it("PDF : TVA totale ET TVA récupérable pour le carburant uniquement", () => {
    const fuel = expenseAmountRows({ amount_ttc: 120, vat_amount: 20, category: "carburant" });
    expect(fuel.map((r) => r[0])).toEqual(["Montant TTC", "Dont TVA", "TVA récupérable (80 %)"]);
    expect(fuel[1]![1]).toMatch(/20,00/);
    expect(fuel[2]![1]).toMatch(/16,00/);
    const meal = expenseAmountRows({ amount_ttc: 120, vat_amount: 20, category: "repas" });
    expect(meal.map((r) => r[0])).toEqual(["Montant TTC", "Dont TVA"]);
  });
});

import { expenseRules, reconcileExpenseVat } from "../doc-rules";
describe("TVA ticket : taux ≠ montant", () => {
  it("Carrefour SP95 29/09/2026 : TVA 20.00% = 4.79 EUR", () => {
    const f = expenseRules("CARREFOUR\n29/09/2026\nSP95 E5\nTOTAL 28,75 EUR\nTVA 20.00% = 4.79 EUR\nCB 28,75");
    expect(f["amount_ttc"]).toBe(28.75);
    expect(f["vat_rate"]).toBe(20);
    expect(f["vat_amount"]).toBe(4.79);
    expect(recoverableFuelVat("carburant", f["vat_amount"] as number)).toBe(3.83);
    const rows = expenseAmountRows({ amount_ttc: 28.75, vat_amount: f["vat_amount"] as number, category: "carburant" });
    expect(rows[1]![1]).toMatch(/4,79/);
    expect(rows[2]![1]).toMatch(/3,83/);
  });
  it("montant = taux (lecture erronée) corrigé par le texte", () => {
    const f = reconcileExpenseVat({ amount_ttc: 28.75, vat_amount: 20, vat_rate: 20 }, "TVA 20.00% = 4.79 EUR");
    expect(f["vat_amount"]).toBe(4.79);
  });
  it("seulement TTC + taux : TVA incluse calculée", () => {
    expect(reconcileExpenseVat({ amount_ttc: 28.75, vat_amount: null, vat_rate: 20 }).vat_amount).toBe(4.79);
    expect(reconcileExpenseVat({ amount_ttc: 28.75, vat_amount: 20, vat_rate: 20 }).vat_amount).toBe(4.79);
  });
});
