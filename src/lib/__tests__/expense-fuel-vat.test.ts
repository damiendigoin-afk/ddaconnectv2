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
