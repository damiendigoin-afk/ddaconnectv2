import { describe, expect, it } from "vitest";
import { assessOrScan, isGenericModel, suspiciousName, vinBrandConflict } from "../or-scan-validate";

describe("Scan OR 17087 — lecture médiocre jamais créée sans validation", () => {
  it("LA / pate / vétioule / RENAULT + VIN Ford invalide : doutes bloquants avant création", () => {
    const r = assessOrScan({ orNumber: "17087", data: {
      order: { or_number: "17087" },
      client: { last_name: "LA", first_name: "pate" },
      vehicle: { plate: "EB-226-WK", brand: "RENAULT", model: "vétioule", vin: "WF0E0CWP0EFI78246" },
    } });
    const codes = r.doubts.map((d) => d.code);
    expect(codes).toEqual(expect.arrayContaining(["model_generic", "vin_invalid", "vin_brand", "client_suspicious"]));
    expect(r.doubts.filter((d) => ["model_generic", "vin_invalid", "vin_brand", "client_suspicious"].includes(d.code)).every((d) => d.blocking)).toBe(true);
    expect(r.data.vehicle["model"]).toBeUndefined();
    expect(r.data.vehicle["vin"]).toBe("WF0E0CWP0EFI78246"); // conservé pour audit, jamais corrigé
  });
  it("variantes de modèle générique, vrais modèles acceptés", () => {
    for (const m of ["vétioule", "véhioule", "VEHICULE", "Voiture"]) expect(isGenericModel(m)).toBe(true);
    for (const m of ["CLIO", "Austral", "SPRING", "208", "Kangoo"]) expect(isGenericModel(m)).toBe(false);
  });
  it("noms courts légitimes acceptés, mots d'étiquette refusés", () => {
    expect(suspiciousName("LY", "Minh")).toBeNull();
    expect(suspiciousName("NG", "Anh")).toBeNull();
    expect(suspiciousName("LE ROUX", "Paul")).toBeNull();
    expect(suspiciousName("LA", "Pierre")).not.toBeNull();
    expect(suspiciousName("DUPONT", "pate")).not.toBeNull();
  });
  it("VIN : le chiffre 0 est valide ; WMI cohérent = aucun doute ; CP incohérent signalé", () => {
    expect(vinBrandConflict("RENAULT", "VF1RHN00072214934")).toBeNull();
    expect(vinBrandConflict("DACIA", "UU1DBG00XNU086243")).toBeNull();
    expect(vinBrandConflict("RENAULT", "WF0XXXGCDX1234567")).toBe("FORD");
    const ok = assessOrScan({ orNumber: "1", data: { order: {}, client: { last_name: "DUPONT", first_name: "Jean", postal_code: "24200" }, vehicle: { plate: "GY-640-HM", brand: "RENAULT", model: "AUSTRAL", vin: "VF1RHN00072214934" } } });
    expect(ok.doubts).toEqual([]);
    const cp = assessOrScan({ orNumber: "1", data: { order: {}, client: { last_name: "DUPONT", postal_code: "242O0" }, vehicle: { plate: "GY-640-HM" } } });
    expect(cp.doubts.map((d) => d.code)).toContain("address_incoherent");
  });
});
