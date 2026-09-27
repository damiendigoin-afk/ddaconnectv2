import { describe, expect, it } from "vitest";
import { finiteOrNull, formatMeasure, normalizeMeasureValue } from "../measure";

describe("mesures invalides", () => {
  it("NaN mm => aucune mesure affichée", () => {
    expect(formatMeasure("NaN", "mm")).toBeNull();
    expect(normalizeMeasureValue("NaN", "mm")).toBeNull();
  });
  it("Infinity, vide et non numérique sont neutralisés", () => {
    for (const v of ["Infinity", "-Infinity", "", "  ", "abc", Number.NaN, Infinity]) {
      expect(formatMeasure(v, "mm")).toBeNull();
    }
    expect(finiteOrNull("abc")).toBeNull();
    expect(finiteOrNull("3,5")).toBe(3.5);
  });
  it("valeurs valides conservées", () => {
    expect(formatMeasure("4", "mm")).toBe("4 mm");
    expect(formatMeasure("12 450", null)).toBe("12 450");
    expect(formatMeasure("250 CCA", null)).toBe("250 CCA");
  });
});
