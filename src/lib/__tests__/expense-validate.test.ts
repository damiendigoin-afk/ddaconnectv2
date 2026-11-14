import { describe, expect, it } from "vitest";

import {
  expenseSubmissionGuard,
  isRealCalendarDate,
  normalizeExpenseExtract,
  validateExpenseExtract,
} from "../expense-validate";

const TODAY = "2026-11-14";
const codes = (value: Record<string, unknown>, mode: "scan" | "submit" | "manager" = "scan") =>
  validateExpenseExtract(value, { today: TODAY, mode }).issues.map((issue) => issue.code);

describe("validation déterministe des tickets de frais", () => {
  it("Carrefour carburant 07/11/2026 : 93,28 TTC, 44,04 L, TVA réelle 15,55 à 20 %", () => {
    const result = validateExpenseExtract(
      { date: "2026-11-07", amount_ttc: 93.28, quantity_litres: 44.04, vat_amount: 15.55, vat_rate: 20, vat_amount_source: "ticket" },
      { today: TODAY },
    );
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("Carrefour 29/09/2026 : TVA 20,00 % = 4,79 EUR, jamais 20 EUR", () => {
    const valid = { date: "2026-09-29", amount_ttc: 28.75, vat_amount: 4.79, vat_rate: 20, vat_amount_source: "ticket" };
    expect(codes(valid)).toEqual([]);
    expect(codes({ ...valid, vat_amount: 20 })).toContain("vat_above_maximum");
    const normalized = normalizeExpenseExtract({ ...valid, vat_amount: 20 }, { today: TODAY });
    expect(normalized["vat_amount"]).toBeNull();
    expect(normalized["verification_required"]).toBe(true);
    expect(normalized["expense_issues"]).toEqual(expect.arrayContaining([expect.objectContaining({ code: "vat_above_maximum" })]));
  });

  it("Carrefour 16/09/2026 lu 2020 : confirmation, jamais autocorrection", () => {
    const input = { date: "2020-09-16", amount_ttc: 40, vat_amount: 6.67, vat_rate: 20, vat_amount_source: "ticket" };
    expect(codes(input)).toContain("old_date");
    const normalized = normalizeExpenseExtract(input, { today: TODAY });
    expect(normalized["date"]).toBe("2020-09-16");
    expect(normalized["review_fields"]).toContain("date");
  });

  it("McDonald's Déols 04/11/2026 lu 01/02/2054 : futur à confirmer au scan, à corriger chez le manager", () => {
    const input = { date: "2054-02-01", amount_ttc: 18.4 };
    expect(codes(input)).toContain("future_date");
    expect(validateExpenseExtract(input, { today: TODAY }).requiresCorrection).toBe(false);
    expect(validateExpenseExtract(input, { today: TODAY, mode: "manager" }).requiresCorrection).toBe(true);
  });

  it("Carrefour 05/10/2026 : TVA 10,22 sur TTC 61,33 à 20 %, pas 26 %", () => {
    const valid = { date: "2026-10-05", amount_ttc: 61.33, vat_amount: 10.22, vat_rate: 20, vat_amount_source: "ticket" };
    expect(codes(valid)).toEqual([]);
    expect(codes({ ...valid, vat_rate: 26 })).toContain("rate_26");
    const normalized = normalizeExpenseExtract({ ...valid, vat_rate: 26 }, { today: TODAY });
    expect(normalized["vat_rate"]).toBeNull();
    expect(normalized["expense_issues"]).toEqual(expect.arrayContaining([expect.objectContaining({ code: "rate_26" })]));
  });

  it("restaurant multi-taux 5,5 / 10 / 20 : somme explicite conservée, aucun taux unique", () => {
    const input = {
      date: "2026-11-04",
      amount_ttc: 55,
      vat_rate: null,
      vat_amount: 5.25,
      vat_amount_source: "ticket",
      vat_lines: [{ rate: 5.5, amount: 0.5 }, { rate: 10, amount: 1.75 }, { rate: 20, amount: 3 }],
    };
    expect(codes(input)).toEqual([]);
    expect(codes({ ...input, vat_rate: 20 })).toContain("single_rate_on_multi");
    const calculated = normalizeExpenseExtract({ ...input, vat_amount: 9.17, vat_amount_source: "calculated" }, { today: TODAY });
    expect(calculated["vat_amount"]).toBeNull();
    expect(calculated["expense_issues"]).toEqual(expect.arrayContaining([expect.objectContaining({ code: "calculated_vat_on_multi" })]));
  });

  it("une TVA explicitement imprimée prime sur le calcul et n'est jamais réécrite", () => {
    const input = { date: "2026-11-01", amount_ttc: 30, vat_amount: 4.81, vat_rate: 20, vat_amount_source: "ticket" };
    const normalized = normalizeExpenseExtract(input, { today: TODAY });
    expect(normalized["vat_amount"]).toBe(4.81);
    expect(normalized["expense_issues"]).toEqual(expect.arrayContaining([expect.objectContaining({ code: "vat_rate_mismatch" })]));
  });

  it("une TVA calculée à taux unique est identifiée comme théorique", () => {
    const result = validateExpenseExtract(
      { date: "2026-11-01", amount_ttc: 28.75, vat_amount: 4.79, vat_rate: 20, vat_amount_source: "calculated" },
      { today: TODAY },
    );
    expect(result.issues.map((issue) => issue.code)).toContain("calculated_vat");
  });

  it("taux manquant : aucune TVA ni aucun taux n'est déduit", () => {
    const input = { date: "2026-11-01", amount_ttc: 28.75, vat_amount: null, vat_rate: null };
    const normalized = normalizeExpenseExtract(input, { today: TODAY });
    expect(normalized["vat_amount"]).toBeNull();
    expect(normalized["vat_rate"]).toBeNull();
    expect(normalized["verification_required"]).toBe(false);
  });

  it("taux 0 seulement avec justification et 26 toujours bloquant à la soumission", () => {
    const zero = { date: "2026-11-01", amount_ttc: 20, vat_rate: 0, vat_amount: 0 };
    expect(expenseSubmissionGuard(zero, { today: TODAY, confirmed: true }).allowed).toBe(false);
    expect(expenseSubmissionGuard(zero, { today: TODAY, confirmed: true, zeroVatJustification: "Exonération mentionnée sur le reçu" }).allowed).toBe(true);
    expect(expenseSubmissionGuard({ ...zero, vat_rate: 26 }, { today: TODAY, confirmed: true }).allowed).toBe(false);
  });

  it("voyage historique volontaire : confirmation requise, valeur inchangée", () => {
    const input = { date: "2025-01-12", amount_ttc: 120 };
    const first = expenseSubmissionGuard(input, { today: TODAY });
    expect(first.allowed).toBe(false);
    expect(first.issues[0]).toMatchObject({ code: "old_date", severity: "confirmation" });
    expect(expenseSubmissionGuard(input, { today: TODAY, confirmed: true }).allowed).toBe(true);
  });

  it("dates civiles réelles seulement, avec un jour de tolérance pour le futur", () => {
    expect(isRealCalendarDate("2026-02-29")).toBe(false);
    expect(isRealCalendarDate("2028-02-29")).toBe(true);
    expect(codes({ date: "2026-11-15", amount_ttc: 10 })).not.toContain("future_date");
    expect(codes({ date: "2026-11-16", amount_ttc: 10 })).toContain("future_date");
  });

  it("écarte ou signale les chiffres confondus avec litres, téléphone et SIRET", () => {
    expect(codes({ date: "2026-11-01", amount_ttc: 40, vat_rate: 20, quantity_litres: 20 })).toContain("quantity_confused");
    expect(codes({ date: "2026-11-01", amount_ttc: 40, merchant: "0553612345" })).toContain("merchant_identifier");
    const normalized = normalizeExpenseExtract({ date: "2026-11-01", amount_ttc: 40, quantity_litres: "44,04 L" }, { today: TODAY });
    expect(normalized["quantity_litres"]).toBeNull();
  });

  it("garde-fou manager : 26 %, TVA excessive et date future exigent une correction avant toute transmission", () => {
    const base = { date: "2026-11-01", amount_ttc: 61.33, vat_amount: 10.22, vat_rate: 20 };
    expect(expenseSubmissionGuard({ ...base, vat_rate: 26 }, { today: TODAY, mode: "manager", confirmed: true }).allowed).toBe(false);
    expect(expenseSubmissionGuard({ ...base, vat_amount: 20 }, { today: TODAY, mode: "manager", confirmed: true }).allowed).toBe(false);
    expect(expenseSubmissionGuard({ ...base, date: "2054-02-01" }, { today: TODAY, mode: "manager", confirmed: true }).allowed).toBe(false);
    expect(expenseSubmissionGuard(base, { today: TODAY, mode: "manager" }).allowed).toBe(true);
  });

  it("détails secondaires non enregistrés : alerte à confirmer, jamais impasse de saisie", () => {
    const result = expenseSubmissionGuard({ date: "2026-11-01", amount_ttc: 40, transaction_time: "25:70", quantity_litres: "44,04 L" }, { today: TODAY });
    expect(result.requiresCorrection).toBe(false);
    expect(result.allowed).toBe(false);
    expect(expenseSubmissionGuard({ date: "2026-11-01", amount_ttc: 40, transaction_time: "25:70", quantity_litres: "44,04 L" }, { today: TODAY, confirmed: true }).allowed).toBe(true);
  });

  it("contrôle quantité × prix au litre et HT + TVA = TTC", () => {
    expect(codes({ date: "2026-11-01", amount_ttc: 93.28, quantity_litres: 44.04, unit_price_litre: 2.118 })).toEqual([]);
    expect(codes({ date: "2026-11-01", amount_ttc: 93.28, quantity_litres: 20, unit_price_litre: 2.118 })).toContain("fuel_total_mismatch");
    expect(codes({ date: "2026-11-01", amount_ttc: 12, amount_ht: 10, vat_amount: 1 })).toContain("ht_vat_ttc_mismatch");
  });
});
