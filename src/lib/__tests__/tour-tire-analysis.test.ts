import { describe, expect, it } from "vitest";
import { normalizeTireStep } from "../tire-step";
import { estimatedAnalysisProgress, legacyTireAnalysis, replacementRecommendation, TOUR_TIRE_KEYS } from "../tour-tire-analysis";

const tire = (mm: number, obs: string[] = []) => normalizeTireStep({ sidewall: { size: "205/55 R16 91V" }, depth: { inner_mm: mm, center_mm: mm, outer_mm: mm }, wear: { observations: obs } });

describe("Tour pneus global", () => {
  it("prévoit exactement quatre roues × trois photos", () => expect(TOUR_TIRE_KEYS.length * 3).toBe(12));
  it("progression estimée plafonnée à 95 avant réponse", () => { expect(estimatedAnalysisProgress(0)).toBe(4); expect(estimatedAnalysisProgress(120_000)).toBe(95); });
  it("un pneu critique entraîne une paire sur son essieu", () => expect(replacementRecommendation({ pneu_avg: tire(1.6), pneu_avd: tire(5), pneu_arg: tire(5), pneu_ard: tire(5) })).toMatchObject({ quantity: 2, axles: ["avant"] }));
  it("avant + arrière entraînent quatre pneus", () => expect(replacementRecommendation({ pneu_avg: tire(5, ["corde visible"]), pneu_arg: tire(1.2) })).toMatchObject({ quantity: 4 }));
  it("adaptateur conserve dimension et pire profondeur pour le devis existant", () => { const x = legacyTireAnalysis(normalizeTireStep({ sidewall: { size: "205/55 R16 91V" }, depth: { inner_mm: 4, center_mm: 2.5, outer_mm: 3 } })); expect(x.ai.depth_mm).toBe(2.5); expect(x.confirmedRef).toBe("205/55 R16 91V"); });
});