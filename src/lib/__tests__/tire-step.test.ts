import { describe, expect, it } from "vitest";

import { budgetStatus, parisDayStartIso } from "../ai-budget-day";
import { TIRE_STEP_DEFAULT_MODEL, adjustDepth, pickTireStepModel, resolveInnerSide, zoneLabels, isAsymmetric, normalizeTireStep, parseDot, parseTireSize, quoteSearchFromResult, wearLevel } from "../tire-step";

describe("budget journalier partagé", () => {
  it("50 crédits configurés => plafond 50, jamais 3", () => {
    expect(budgetStatus(50, 3.2)).toEqual({ daily: 50, spentToday: 3.2, remaining: 46.8 });
  });
  it("restant jamais négatif", () => {
    expect(budgetStatus(5, 7).remaining).toBe(0);
  });
  it("reset à minuit heure de Paris (été : 22:00 UTC)", () => {
    expect(parisDayStartIso(new Date("2026-10-03T09:42:00Z"))).toBe("2026-10-02T22:00:00.000Z");
  });
  it("reset à minuit heure de Paris (hiver : 23:00 UTC)", () => {
    expect(parisDayStartIso(new Date("2026-12-15T00:30:00Z"))).toBe("2026-12-14T23:00:00.000Z");
  });
});

describe("étape pneu", () => {
  it("dimension 205/55 R16 91V découpée", () => {
    expect(parseTireSize("205/55 R16 91V")).toEqual({ width: 205, height: 55, diameter: 16, load: "91", speed: "V" });
  });
  it("DOT 2321 = semaine 23 / 2021", () => {
    expect(parseDot("DOT XX 2321")).toEqual({ week: 23, year: 2021 });
  });
  it("profondeurs 1 / 3 / 4 => profil 3 points et dissymétrie", () => {
    const r = normalizeTireStep({ sidewall: { size: "205/55 R16 91V" }, depth: { inner_mm: 1, center_mm: 3, outer_mm: 4 } });
    expect(r.depth.points_mm).toEqual([1, 3, 4]);
    expect(isAsymmetric(r.depth)).toBe(true);
    expect(r.sidewall.width).toBe(205);
  });
  it("profondeur aberrante rejetée", () => {
    expect(normalizeTireStep({ depth: { inner_mm: 42 } }).depth.inner_mm).toBeNull();
  });
  it("seuils : 1,6 critique, 2,5 à surveiller, 4 bon", () => {
    expect([wearLevel(1.6), wearLevel(2.5), wearLevel(4)]).toEqual(["critique", "surveiller", "bon"]);
  });
  it("devis prérempli avec la dimension lue", () => {
    const r = normalizeTireStep({ sidewall: { size: "205/55 R16 91V", brand: "Michelin" } });
    expect(quoteSearchFromResult(r)).toEqual({ w: "205", h: "55", d: "16", li: "91", si: "V", brand: "Michelin" });
  });
  it("modèle par défaut 3.1 Pro, modèle choisi respecté, inconnu refusé", () => {
    expect(TIRE_STEP_DEFAULT_MODEL).toBe("google/gemini-3.1-pro-preview");
    expect(pickTireStepModel("google/gemini-3.5-flash")).toBe("google/gemini-3.5-flash");
    expect(pickTireStepModel("google/gemini-3.1-pro-preview")).toBe("google/gemini-3.1-pro-preview");
    expect(pickTireStepModel("google/gemini-3.8-flash")).toBe("google/gemini-3.8-flash");
    expect(pickTireStepModel("openai/inconnu")).toBe("google/gemini-3.1-pro-preview");
  });
  it("orientation inconnue => Gauche/Milieu/Droite, jamais inversée", () => {
    expect(zoneLabels(null)).toEqual(["Gauche", "Milieu", "Droite"]);
    expect(zoneLabels("droite")).toEqual(["Extérieur", "Milieu", "Intérieur"]);
    expect(resolveInnerSide("auto", null)).toBeNull();
    expect(resolveInnerSide("inconnue", "gauche")).toBeNull();
    expect(resolveInnerSide("gauche", null)).toBe("gauche");
  });
  it("geste : haut +0,1 par cran, bas -0,1, bornes 0 et 12, tap sans effet", () => {
    expect(adjustDepth(3, -16)).toBe(3.2);
    expect(adjustDepth(3, 24)).toBe(2.7);
    expect(adjustDepth(0.1, 80)).toBe(0);
    expect(adjustDepth(11.9, -80)).toBe(12);
    expect(adjustDepth(4.5, 3)).toBe(4.5);
  });
});
