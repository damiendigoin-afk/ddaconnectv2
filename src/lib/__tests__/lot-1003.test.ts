import { describe, expect, it } from "vitest";
import { strictPlate } from "../plate";
import { isPlausibleModel, repairOrderRules, sanitizeRepairOrder, splitTableRow } from "../doc-rules";
import { afterTourEnsure, decideTourScan } from "../or-scan-decision";
import { MAX_QUOTE_PHOTOS, TIRE_CAMERA_STEPS, TIRE_STEP_DEFAULT_MODEL, cameraStepsFrom, mergeQuotePhotos, nextCaptureRole, pickTireStepModel } from "../tire-step";

describe("État pneus", () => {
  it("défaut Gemini 3.1 Pro", () => {
    expect(TIRE_STEP_DEFAULT_MODEL).toBe("google/gemini-3.1-pro-preview");
    expect(pickTireStepModel(null)).toBe("google/gemini-3.1-pro-preview");
  });
  it("Bande -> Flanc -> Complément", () => {
    expect(nextCaptureRole("tread")).toBe("sidewall");
    expect(nextCaptureRole("sidewall")).toBe("other");
    expect(cameraStepsFrom("sidewall").map((s) => s.key)).toEqual(["sidewall", "other"]);
  });
  it("masque U pour la bande, cercle pour le flanc", () => {
    expect(TIRE_CAMERA_STEPS.map((s) => s.mask)).toEqual(["tread", "sidewall", "free"]);
  });
  it("photos du devis : une par position, 4 max", () => {
    let l = mergeQuotePhotos([], { dataUrl: "a", caption: "AVG", position: "AVG" });
    l = mergeQuotePhotos(l, { dataUrl: "b", caption: "AVG", position: "AVG" });
    expect(l).toEqual([{ dataUrl: "b", caption: "AVG", position: "AVG" }]);
    for (const p of ["AVD", "ARG", "ARD", "X"]) l = mergeQuotePhotos(l, { dataUrl: p, caption: p, position: p });
    expect(l.length).toBe(MAX_QUOTE_PHOTOS);
  });
});

describe("Tour du véhicule : entrée rapide", () => {
  it("immat seule : tour sans OR", () => {
    expect(decideTourScan({ or_number: null, plate: "EM-426-NG" })).toEqual({ kind: "plate_only", plate: "EM-426-NG" });
  });
  it("OR reconnu : ouverture du dossier", () => {
    expect(decideTourScan({ or_number: "50873", plate: null }).kind).toBe("ensure_or");
    expect(afterTourEnsure("50873", null, { id: "x" })).toEqual({ kind: "open", orId: "x" });
  });
  it("OR non retrouvé mais immat : on continue", () => {
    expect(afterTourEnsure("50873", "EM-426-NG", { error: "site_required" }).kind).toBe("continue_without_or");
  });
});

describe("Scan OR : garde-fous", () => {
  it("EM426NG => EM-426-NG", () => expect(strictPlate("EM426NG")).toBe("EM-426-NG"));
  it("EMA426NG ambigu rejeté, tranché seulement par une autre lecture", () => {
    expect(strictPlate("EMA426NG")).toBeNull();
    expect(strictPlate("EMA426NG", "EM-426-NG")).toBe("EM-426-NG");
  });
  it("correction unique acceptée (sosie dans les chiffres)", () => expect(strictPlate("EM4Z6NG")).toBe("EM-426-NG"));
  it("immat IA incohérente rejetée et signalée", () => {
    const r = sanitizeRepairOrder({ vehicle: { plate: "EMA426NG" } });
    expect((r.fields["vehicle"] as Record<string, unknown>)["plate"]).toBeNull();
    expect(r.rejected).toContain("vehicle.plate");
  });
  it("modèle numérique ou égal au n° compte rejeté", () => {
    expect(isPlausibleModel("012384")).toBe(false);
    expect(isPlausibleModel("CLIO V")).toBe(true);
    const r = sanitizeRepairOrder({ client: { account_number: "C012384" }, vehicle: { model: "C012384" } });
    expect((r.fields["vehicle"] as Record<string, unknown>)["model"]).toBeNull();
  });
  it("tableau Renault séparé", () => {
    expect(splitTableRow(["plate", "brand", "model", "account"], "EM-426-NG RENAULT CLIO V 012384")).toEqual({ plate: "EM-426-NG", brand: "RENAULT", account: "012384", model: "CLIO V" });
    const f = repairOrderRules("ORDRE DE REPARATION N° 50873\nImmat. Merque Modile N° compte\nEM426NG RENAULT CLIO V 012384") as Record<string, Record<string, unknown>>;
    expect(f["vehicle"]!["plate"]).toBe("EM-426-NG");
    expect(f["vehicle"]!["model"]).toBe("CLIO V");
    expect(f["client"]!["account_number"]).toBe("012384");
  });
});
