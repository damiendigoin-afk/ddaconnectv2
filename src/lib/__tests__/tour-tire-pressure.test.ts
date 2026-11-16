import { describe, expect, it } from "vitest";
import {
  isTirePressureChecked,
  tirePressureState,
  mergeTourTireAnalysis,
  tirePressureReportLabel,
  tourTirePressureRows,
  withTirePressureChecked,
} from "../tour-tire-pressure";

describe("TDV — confirmation de pression par roue", () => {
  it("un ancien JSON sans clé reste décoché et non confirmé, jamais un défaut", () => {
    expect(isTirePressureChecked(null)).toBe(false);
    expect(isTirePressureChecked({ ai: { depth_mm: 4 }, confirmedRef: "205/55 R16 91V" })).toBe(false);
    expect(tirePressureReportLabel({})).toBe("Pression vérifiée : Non renseignée");
    expect(tirePressureReportLabel({ pressure_checked: "true" })).toBe("Pression vérifiée : Non renseignée");
    expect(tirePressureReportLabel({ pressure_checked: false })).toBe("Pression vérifiée : Non contrôlée");
    expect(tirePressureState({})).toBe("unset");
  });

  it("coche et décoche une seule roue sans toucher à son analyse ni aux trois autres", () => {
    const original = { ai: { depth_mm: 4 }, confirmedRef: "205/55 R16 91V", corrections: [{ reason: "mesure" }] };
    const checked = withTirePressureChecked(original, true);
    expect(checked).toMatchObject({ ...original, pressure_checked: true });
    expect(withTirePressureChecked(checked, false)).toMatchObject({ ...original, pressure_checked: false });

    const points = ["pneu_avg", "pneu_avd", "pneu_arg", "pneu_ard"].map((key, index) => ({
      id: key,
      point_key: key,
      point_label: `Pneu ${index + 1}`,
      tire_analysis: key === "pneu_avd" ? checked : original,
    }));
    expect(tourTirePressureRows(points).map((row) => row.status)).toEqual([
      "Pression vérifiée : Non renseignée",
      "Pression vérifiée : Oui",
      "Pression vérifiée : Non renseignée",
      "Pression vérifiée : Non renseignée",
    ]);
  });

  it("une analyse ou un recalcul conserve la coche vraie comme fausse et les métadonnées existantes", () => {
    for (const checked of [true, false]) {
      const merged = mergeTourTireAnalysis(
        { pressure_checked: checked, confirmedRef: "195/55 R16 87H", corrections: [{ reason: "atelier" }] },
        { ai: { depth_mm: 2 }, globalModel: "modele-test", pressure_checked: !checked },
      );
      expect(merged).toMatchObject({
        pressure_checked: checked,
        confirmedRef: "195/55 R16 87H",
        corrections: [{ reason: "atelier" }],
        ai: { depth_mm: 2 },
        globalModel: "modele-test",
      });
    }
  });
});
