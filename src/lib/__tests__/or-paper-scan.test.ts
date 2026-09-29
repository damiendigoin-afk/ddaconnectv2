import { describe, expect, it } from "vitest";
import { repairOrderRules } from "../doc-rules";
import { parseRepairOrderScan } from "../or-scan-decision";

const OR_TXT = `GARAGE DDA CASTILLON
ORDRE DE REPARATION N° 16991
Date OR : 29/09/2026
Client : M. DUPONT Jean
12 rue des Vignes
33350 CASTILLON LA BATAILLE
Tél : 05 57 40 12 34
Portable : 06.12.34.56.78
jean.dupont@example.fr
Véhicule : PEUGEOT 208 1.2 PURETECH
Immat : HG 732 GH
VIN VF3ABCDEFGH123456
Kilométrage : 84 512 km
Travaux demandés :
Vidange
Plaquettes AV`;

describe("repairOrderRules (OR papier, sans IA)", () => {
  const f = repairOrderRules(OR_TXT) as Record<string, Record<string, unknown>>;
  it("lit OR, immat, VIN, km, marque", () => {
    expect(f["order"]!["or_number"]).toBe("16991");
    expect(f["order"]!["or_date"]).toBe("2026-09-29");
    expect(f["vehicle"]!["plate"]).toBe("HG-732-GH");
    expect(f["vehicle"]!["vin"]).toBe("VF3ABCDEFGH123456");
    expect(f["vehicle"]!["mileage"]).toBe(84512);
    expect(f["vehicle"]!["brand"]).toBe("PEUGEOT");
  });
  it("lit le client complet", () => {
    expect(f["client"]!["last_name"]).toBe("DUPONT");
    expect(f["client"]!["first_name"]).toBe("Jean");
    expect(f["client"]!["postal_code"]).toBe("33350");
    expect(f["client"]!["address"]).toBe("12 rue des Vignes");
    expect(f["client"]!["phone"]).toBe("05 57 40 12 34");
    expect(f["client"]!["mobile"]).toBe("06 12 34 56 78");
    expect(f["client"]!["email"]).toBe("jean.dupont@example.fr");
    expect(String(f["order"]!["requested_work"])).toContain("Vidange");
  });
  it("n'invente rien sur un OR très incomplet", () => {
    const g = repairOrderRules("OR N° 16991") as Record<string, Record<string, unknown>>;
    expect(g["vehicle"]!["plate"]).toBeNull();
    expect(g["client"]!["last_name"]).toBeNull();
    expect(g["client"]!["email"]).toBeNull();
  });
});

describe("parseRepairOrderScan", () => {
  it("extrait n° OR, immat et retire les champs vides", () => {
    const s = parseRepairOrderScan(JSON.stringify({ order: { or_number: "16991" }, vehicle: { plate: "HG-732-GH", vin: null }, client: { email: "" } }));
    expect(s.or_number).toBe("16991");
    expect(s.plate).toBe("HG-732-GH");
    expect(s.data.vehicle).toEqual({ plate: "HG-732-GH" });
    expect(s.data.client).toEqual({});
  });
  it("JSON invalide => rien", () => {
    expect(parseRepairOrderScan("x").or_number).toBeNull();
  });
});
