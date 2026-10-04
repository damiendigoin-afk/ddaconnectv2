import { describe, expect, it } from "vitest";
import { repairOrderRules, sanitizeRepairOrder, cleanOrFreeText } from "../doc-rules";

// OCR reconstitué de la photo OR 50864 (FF-114-QR, Castillon) : zone « Travaux à effectuer » vide.
const OR_50864 = `RENAULT care service
longue vie aux voitures à vivre
ORDRE DE REPARATION N° 50864
Travaux à effectuer :
dant
service
longue vie aux voitures à vivre
votre conseiller
accueilli par : A renseigner
Mme BESSET SAMUELLE
MR BESSET PATRICE
2000 ROUTE DE ST CYPRIEN LES
Immat. FF114QR
Kilométrage : 93905 km`;

const run = (t: string) => sanitizeRepairOrder(repairOrderRules(t)).fields as Record<string, Record<string, unknown>>;

describe("OR 50864 : travaux prévus jamais pollués", () => {
  const f = run(OR_50864);
  it("zone Travaux à effectuer vide => vide", () => {
    expect(f["order"]!["requested_work"] ?? null).toBeNull();
  });
  it("OR, plaque et km conservés", () => {
    expect(f["order"]!["or_number"]).toBe("50864");
    expect(f["vehicle"]!["plate"]).toBe("FF-114-QR");
    expect(f["vehicle"]!["mileage"]).toBe(93905);
  });
  it("une réponse IA polluée est aussi nettoyée", () => {
    const g = sanitizeRepairOrder({ client: { last_name: "BESSET", first_name: "SAMUELLE" }, vehicle: {}, order: { requested_work: "dant\nservice\nlongue vie aux voitures à vivre\nvotre conseiller\naccueilli par : A renseigner\nMme BESSET SAMUELLE\nMR BESSET PATRICE\n2000 ROUTE DE ST CYPRIEN LES" } }).fields as Record<string, Record<string, unknown>>;
    expect(g["order"]!["requested_work"]).toBeNull();
  });
});

describe("vrais travaux conservés", () => {
  it("ligne réelle sous Travaux à effectuer", () => {
    const f = run(OR_50864.replace("Travaux à effectuer :\ndant", "Travaux à effectuer :\nVidange + filtre à huile\nBruit train avant\ndant"));
    expect(f["order"]!["requested_work"]).toBe("Vidange + filtre à huile\nBruit train avant");
  });
  it("cleanOrFreeText garde les travaux", () => {
    expect(cleanOrFreeText("Remplacement plaquettes AV\nContrôle freinage")).toBe("Remplacement plaquettes AV\nContrôle freinage");
  });
});
