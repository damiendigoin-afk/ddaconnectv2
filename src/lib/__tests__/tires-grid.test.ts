import { describe, expect, it } from "vitest";

import { checkCompatibility, gradeFromDepth, judgeTire, wearGrid } from "../tires";

const grid = wearGrid(null);

describe("grille d'usure pneumatique", () => {
  it("applique les seuils validés", () => {
    expect(gradeFromDepth(5, grid)).toBe("correct");
    expect(gradeFromDepth(4, grid)).toBe("a_prevoir");
    expect(gradeFromDepth(3, grid)).toBe("a_prevoir");
    expect(gradeFromDepth(2.5, grid)).toBe("rapide");
    expect(gradeFromDepth(1.6, grid)).toBe("imperatif");
    expect(gradeFromDepth(null, grid)).toBeNull();
  });

  it("ne laisse pas la sévérité atténuer un danger manifeste", () => {
    const j = judgeTire({ depth_mm: 6, bulges: true }, grid, "permissif");
    expect(j.grade).toBe("imperatif");
  });

  it("module uniquement les appréciations subjectives", () => {
    expect(judgeTire({ depth_mm: 6, cracks: true }, grid, "permissif").grade).toBe("correct");
    expect(judgeTire({ depth_mm: 6, cracks: true }, grid, "standard").grade).toBe("a_prevoir");
    expect(judgeTire({ depth_mm: 6, cracks: true }, grid, "severe").grade).toBe("a_prevoir");
  });
});

describe("compatibilité pneumatique", () => {
  it("exige dimension, charge et vitesse", () => {
    const base = { requiredSize: "205/55R16", requiredLoad: "91", requiredSpeed: "V" };
    expect(
      checkCompatibility({ ...base, offerSize: "205/55 R16", offerLoad: "91", offerSpeed: "V" }).status,
    ).toBe("compatible");
    expect(
      checkCompatibility({ ...base, offerSize: "205/55R16", offerLoad: "88", offerSpeed: "V" }).status,
    ).toBe("a_confirmer");
    expect(
      checkCompatibility({ ...base, offerSize: "225/45R17", offerLoad: "91", offerSpeed: "V" }).status,
    ).toBe("a_confirmer");
  });
});
