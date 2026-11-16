import { describe, expect, it } from "vitest";
import { normalizeVin } from "../vin";
import { applyVehicleSource, crossIxellio } from "../vehicle-dates";
import { parseRepairOrderScan } from "../or-scan-decision";

const found = (v: Record<string, string>) => ({ outcome: "auth_ok_vehicle_found", vehicle: v });

describe("normalisation VIN", () => {
  it("GM-634-SG : O lu par l'OCR corrigé en 0, brute conservée", () => {
    const n = normalizeVin("uu1dbg-OOXNU 086243");
    expect(n.vin).toBe("UU1DBG00XNU086243");
    expect(n.corrected).toBe(true);
    expect(n.raw).toBe("uu1dbg-OOXNU 086243");
  });
  it("I et Q jamais corrigées, longueur contrôlée", () => {
    expect(normalizeVin("UU1DBG00XNU08624Q").vin).toBeNull();
    expect(normalizeVin("UU1DBG00XNU08624Q").issue).toBe("alphabet");
    expect(normalizeVin("UU1DBG00XNU0862").issue).toBe("length");
    expect(normalizeVin("").issue).toBe("empty");
  });
  it("extraction OCR partagée : VIN normalisé et brute tracée", () => {
    const r = parseRepairOrderScan(JSON.stringify({ vehicle: { plate: "GM-634-SG", vin: "UU1DBGOOXNU086243" }, order: { or_number: "17500" } }));
    expect(r.data.vehicle["vin"]).toBe("UU1DBG00XNU086243");
    expect(r.data.vehicle["vin_ocr_raw"]).toBe("UU1DBGOOXNU086243");
  });
});

describe("croisement Ixellio et choix de source", () => {
  it("O/0 seulement : aucune divergence, MEC identique confirmée", () => {
    const c = crossIxellio({ vin: "UU1DBGOOXNU086243", first_registration: "2023-03-15", brand: "DACIA" }, found({ vin: "UU1DBG00XNU086243", dateMec: "15/03/2023", marque: "DACIA" }));
    expect(c.vinMismatch).toBe(false);
    expect(c.mec).toBe("same");
    expect(c.readVinRaw).toBe("UU1DBGOOXNU086243");
  });

  const vehicle = { plate: "GM-634-SG", vin: "UU1DBG00XNU086299", brand: "DACIA", model: "SPRING", mileage: 41200, delivery_date: "2026-07-18", first_registration: "2023-03-15" };
  const cross = crossIxellio(vehicle, found({ vin: "UU1DBG00XNU086243", dateMec: "16/03/2023", marque: "DACIA", modele: "SPRING ELECTRIQUE" }));

  it("vrai désaccord : enrichissement stoppé tant qu'aucun choix", () => {
    expect(cross.vinMismatch).toBe(true);
    expect(cross.mec).toBe("none");
  });
  it("choix Ixellio : VIN/MEC/modèle Ixellio, kilométrage et livraison préservés", () => {
    const v = applyVehicleSource(vehicle, cross, "ixellio");
    expect(v).toMatchObject({ vin: "UU1DBG00XNU086243", vin_source: "ixellio", vin_ocr_raw: "UU1DBG00XNU086299", first_registration: "2023-03-16", first_registration_source: "ixellio", model: "SPRING ELECTRIQUE", mileage: 41200, delivery_date: "2026-07-18" });
  });
  it("choix OR : aucune donnée Ixellio appliquée", () => {
    const v = applyVehicleSource(vehicle, cross, "or");
    expect(v).toMatchObject({ vin: "UU1DBG00XNU086299", vin_source: "ocr_or", first_registration: "2023-03-15", model: "SPRING" });
  });
  it("champs absents côté Ixellio : jamais d'écrasement par du vide, livraison jamais MEC", () => {
    const c = crossIxellio({ vin: "UU1DBG00XNU086299" }, found({ vin: "UU1DBG00XNU086243" }));
    const v = applyVehicleSource({ vin: "UU1DBG00XNU086299", brand: "DACIA", delivery_date: "2026-07-18" }, c, "ixellio");
    expect(v["brand"]).toBe("DACIA");
    expect(v["first_registration"]).toBeUndefined();
    expect(v["delivery_date"]).toBe("2026-07-18");
  });
});
