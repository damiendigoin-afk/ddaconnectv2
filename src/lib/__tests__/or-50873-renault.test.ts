import { describe, expect, it, vi } from "vitest";
import { repairOrderRules, sanitizeRepairOrder, isOrParasiteValue } from "../doc-rules";
import { runDocPipeline } from "../doc-pipeline";
import { parseRepairOrderScan } from "../or-scan-decision";

type F = Record<string, Record<string, unknown>>;

// Transcription de l'OR Renault / WinMotor 50873 (en-tête garage + zones libellées).
const OR_50873 = `SAS CASTILLON-VEYSSIERE
Agent Renault
1340 route de Beynac
24220 CASTELS ET BEZENAC
Tél : 05 53 29 20 23
ORDRE DE REPARATION N° 50873
Votre conseiller : Adrien accueilli par Adrien
Mr GUERE JEAN MARIE
160 ROUTE DU SORBIER
24220 ST VINCENT DE COSSE
N° compte : 012384
Tel portable : 06 03 95 46 54
Email : jmguere@wanadoo.fr
Téléphone : 05 53 29 42 93
Marque : RENAULT
Modèle véhicule : CAPTUR BDCI 115
Immatriculation : FV123EY
VIN : VF1RJB00X66459265/W
Date livraison : 19/11/2020
Kilométrage : 31 115
TAPV : HFAD
Entrée : 24/09/2026 14:24
Restitution : 24/09/2026
Dernière vente VO : 24/10/2024
Remarque client : REVISION 33000 KM + OT 30/09/2026
Travaux demandés :
REVISION 33000 KM`;

describe("OR 50873 Renault / WinMotor", () => {
  const f = repairOrderRules(OR_50873) as F;
  it("client : jamais l'en-tête garage", () => {
    expect(f["client"]).toMatchObject({
      last_name: "GUERE", first_name: "JEAN MARIE", address: "160 ROUTE DU SORBIER", postal_code: "24220",
      city: "ST VINCENT DE COSSE", mobile: "06 03 95 46 54", phone: "05 53 29 42 93", email: "jmguere@wanadoo.fr", account_number: "012384",
    });
  });
  it("véhicule : modèle depuis « modèle véhicule », pas depuis « Agent Renault »", () => {
    expect(f["vehicle"]).toMatchObject({
      brand: "RENAULT", model: "CAPTUR BDCI 115", plate: "FV-123-EY", vin: "VF1RJB00X66459265",
      first_registration: "2020-11-19", mileage: 31115, tapv: "HFAD",
    });
  });
  it("OR : n°, entrée, restitution, remarque", () => {
    expect(f["order"]).toMatchObject({
      or_number: "50873", or_date: "2026-09-24", entry_at: "2026-09-24T14:24", delivery_at: "2026-09-24",
      last_vo_sale: "2024-10-24", client_remarks: "REVISION 33000 KM + OT 30/09/2026",
    });
  });
  it("variante OCR bruitée : « SAS SASTILLON » et « z appears accueilli par » rejetés", () => {
    const noisy = OR_50873.replace("SAS CASTILLON-VEYSSIERE", "SAS SASTILLON").replace("Modèle véhicule : CAPTUR BDCI 115", "Modèle véhicule :\nz appears accueilli par").replace("Mr GUERE JEAN MARIE", "");
    const g = repairOrderRules(noisy) as F;
    expect(g["vehicle"]!["model"]).toBeNull();
    expect(g["client"]!["last_name"]).toBeNull();
  });
  it("valeurs parasites détectées", () => {
    for (const v of ["z appears accueilli par", "SAS SASTILLON", "SAS CASTILLON-VEYSSIERE", "Votre conseiller", "Modèle véhicule"]) expect(isOrParasiteValue(v)).toBe(true);
    for (const v of ["CAPTUR BDCI 115", "GUERE", "ST VINCENT DE COSSE"]) expect(isOrParasiteValue(v)).toBe(false);
  });
  it("lecture IA parasite rejetée avant fusion ; lecture crédible conservée", () => {
    const r = sanitizeRepairOrder({ client: { last_name: "SAS SASTILLON" }, vehicle: { model: "z appears accueilli par", brand: "RENAULT" }, order: {} });
    expect(r.rejected).toEqual(["client.last_name", "vehicle.model"]);
    const s = parseRepairOrderScan(JSON.stringify({ order: { or_number: "50873" }, client: { last_name: "SAS SASTILLON" }, vehicle: { model: "CAPTUR BDCI 115" } }));
    expect(s.data.client).toEqual({});
    expect(s.data.vehicle).toEqual({ model: "CAPTUR BDCI 115" });
  });
  it("pipeline : modèle parasite => repli vision, valeur crédible fusionnée, parasite IA ignoré", async () => {
    const noisy = OR_50873.replace("Modèle véhicule : CAPTUR BDCI 115", "Modèle véhicule :\nz appears accueilli par");
    const aiVision = vi.fn(async () => ({ vehicle: { model: "CAPTUR BDCI 115" }, client: { last_name: "SAS SASTILLON" } }));
    const r = await runDocPipeline({ kind: "repair_order", text: noisy, hasImage: true, media: "photo" }, {
      fallbackEnabled: async () => false, aiText: async () => null, aiVision, logLocal: async () => {},
    });
    expect(aiVision).toHaveBeenCalled();
    expect((r.fields["vehicle"] as Record<string, unknown>)["model"]).toBe("CAPTUR BDCI 115");
    expect((r.fields["client"] as Record<string, unknown>)["last_name"]).toBe("GUERE");
  });
  it("lecture complète : aucun appel IA", async () => {
    const aiVision = vi.fn(async () => null);
    const r = await runDocPipeline({ kind: "repair_order", text: OR_50873, hasImage: true, media: "photo" }, {
      fallbackEnabled: async () => false, aiText: async () => null, aiVision, logLocal: async () => {},
    });
    expect(r.route).toBe("ocr_rules");
    expect(aiVision).not.toHaveBeenCalled();
  });
});
