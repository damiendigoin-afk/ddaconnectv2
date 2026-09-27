import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { planFillEmpty, ixellioToRefFields } from "@/lib/ixellio-map";
import { buildRefVehiclePatch, mileageDate, saveRefVehicle } from "@/lib/ref-vehicle-edit";
import { coversAll, entityText, searchTokens } from "@/lib/search-tokens";

describe("tour terminé : redirection vers le rapport", () => {
  it("toutes les navigations vers le rapport remplacent l'historique", () => {
    const src = readFileSync("src/routes/tour.$tourId.index.tsx", "utf8");
    const calls = src.match(/navigate\(\{ to: "\/tour\/\$tourId\/rapport"[^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c).toContain("replace: true");
  });
});

describe("historique kilométrique", () => {
  it("aucune date quand measured_at est null (jamais created_at)", () => {
    expect(mileageDate({ measured_at: null, created_at: "2026-08-22T10:00:00Z" } as never)).toBeNull();
    expect(mileageDate({ measured_at: "2025-03-14T10:00:00Z" })).toBe("14/03/2025");
    const page = readFileSync("src/routes/vehicule.$vehId.tsx", "utf8");
    expect(page).not.toContain("measured_at ?? m.created_at");
  });
});

describe("recherche multi-termes", () => {
  it("normalise et découpe", () => {
    expect(searchTokens("  Marty   Michel ")).toEqual(["MARTY", "MICHEL"]);
    expect(searchTokens("Hélène-Dupré")).toEqual(["HELENE", "DUPRE"]);
  });
  const michel = entityText(["MICHEL", "MARTY", null]);
  const captur = entityText(["FT346QS", "VF1XXXX", "RENAULT", null, "Captur", "Intens", "50268"]);
  it("prénom + nom dans n'importe quel ordre", () => {
    expect(coversAll(searchTokens("Marty Michel"), [michel])).toBe(true);
    expect(coversAll(searchTokens("Michel Marty"), [michel])).toBe(true);
  });
  it("tokens répartis entre client et véhicule / OR liés", () => {
    expect(coversAll(searchTokens("Marty Captur"), [michel, captur])).toBe(true);
    expect(coversAll(searchTokens("Marty FT346QS"), [michel, captur])).toBe(true);
    expect(coversAll(searchTokens("Captur 50268"), [captur])).toBe(true);
    expect(coversAll(searchTokens("Marty Clio"), [michel, captur])).toBe(false);
  });
});

describe("IXELLIO → ref_vehicles, uniquement champs vides", () => {
  const ix = { codeMoteur: "H5H", puissanceFiscale: "6 CV", couleur: "BLANC", marque: "RENAULT", dateMec: "12/05/2021" };
  it("mappe les champs", () => {
    const m = ixellioToRefFields(ix);
    expect(m.engine_code).toBe("H5H");
    expect(m.fiscal_power).toBe(6);
    expect(m.first_registration_date).toBe("2021-05-12");
  });
  it("ne remplace jamais une valeur existante", () => {
    const plan = planFillEmpty({ brand: "RENAULT", color: "GRIS", engine_code: null, fiscal_power: "" }, ix);
    expect(plan.patch).toEqual({ engine_code: "H5H", fiscal_power: 6, first_registration_date: "2021-05-12" });
    expect(plan.kept.map((k) => k.key).sort()).toEqual(["brand", "color"]);
    expect(plan.kept.find((k) => k.key === "color")?.same).toBe(false);
  });
});

describe("édition manuelle ref_vehicles", () => {
  it("patch normalisé et limité aux champs modifiés", () => {
    const p = buildRefVehiclePatch({ registration_display: "AA-111-AA", brand: "RENAULT" }, { registration_display: "ft346qs", brand: "RENAULT", engine_code: "H5H" });
    expect(p).toEqual({ registration_display: "FT-346-QS", registration_normalized: "FT346QS", engine_code: "H5H" });
  });
  it("écrit uniquement dans ref_vehicles, jamais dans vehicles", async () => {
    const eq = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({ update: vi.fn(() => ({ eq })) }));
    await saveRefVehicle({ from } as never, "id-1", { engine_code: "H5H" });
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("ref_vehicles");
    expect(readFileSync("src/components/RefVehicleActions.tsx", "utf8")).not.toMatch(/from\("vehicles"\)|InfoEditForm/);
  });
});
