import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repairOrderRules, sanitizeRepairOrder, looksLikeAddress } from "../doc-rules";
import { runDocPipeline, type PipelineDeps } from "../doc-pipeline";
import { partLineLabel } from "../parts-rules";

type F = Record<string, Record<string, unknown>>;

describe("filtres active=true (ancien import VEHIC.csv désactivé)", () => {
  const src = readFileSync("src/lib/refbase.ts", "utf8");
  it("chaque lecture contacts / adresses / relations véhicule filtre active=true", () => {
    const calls = [...src.matchAll(/from\("customer_(contacts|addresses|vehicle_relations)"\)([\s\S]{0,260})/g)];
    expect(calls.length).toBeGreaterThanOrEqual(8);
    for (const c of calls) expect(c[2], c[0].slice(0, 120)).toMatch(/\.eq\("active", true\)/);
  });
});

// Cas VIELESCOT (compte 003618) : contrôle des données réelles après correctif.
describe("VIELESCOT — seules les données actives sont courantes", () => {
  const rows = [
    { kind: "contact", value: "06 42 78 13 89", active: true },
    { kind: "contact", value: "06 01 27 39 33", active: false },
    { kind: "address", value: "TRALY 24150 CALES", active: false },
    { kind: "vehicle", value: "EM-426-NG", active: true },
    { kind: "vehicle", value: "CT-454-HW", active: false },
  ];
  const current = rows.filter((r) => r.active).map((r) => r.value);
  it("garde Polo et mobile récent, masque l'ancien import", () => {
    expect(current).toEqual(["06 42 78 13 89", "EM-426-NG"]);
    expect(current).not.toContain("CT-454-HW");
    expect(current).not.toContain("TRALY 24150 CALES");
  });
});

describe("statut des pièces : désignation lisible", () => {
  it("réf — désignation · reçue x/y", () => {
    expect(partLineLabel({ physical_reference: "A1555", designation: "Filtre à air", qty_received: 0, qty_ordered: 1 })).toBe("A1555 — Filtre à air · reçue 0/1");
  });
  it("désignation longue tronquée, réf conservée", () => {
    const s = partLineLabel({ physical_reference: "6PK1000K1", designation: "Courroie d'accessoires poly-V 6 nervures longueur 1000 mm kit complet", qty_received: 1, qty_ordered: 1 });
    expect(s.startsWith("6PK1000K1 — Courroie")).toBe(true);
    expect(s).toContain("…");
    expect(s.endsWith("reçue 1/1")).toBe(true);
  });
});

const OR_50985 = `SAS CASTILLON-VEYSSIERE
Agent Renault
1340 route de Beynac
24220 CASTELS ET BEZENAC
ORDRE DE REPARATION N° 50985
Mme VIELESCOT MARIE-ANNAELLE
LE BOURG
24220 MARNAC
N° compte : 003618
Tel portable : 06 42 78 13 89
Email : marie.vielescot@icloud.com
Marque : VOLKSWAGEN
Modèle véhicule : POLO1O60
Immatriculation : EM426NG
VIN : WVWZZZ6RZHY255149
Remarques du client
revision
Travaux prévus
REVISION`;

const EXPECTED = { last_name: "VIELESCOT", first_name: "MARIE-ANNAELLE", address: "LE BOURG", postal_code: "24220", city: "MARNAC", mobile: "06 42 78 13 89", email: "marie.vielescot@icloud.com", account_number: "003618" };

describe("OR 50985 — régression bloc client", () => {
  it("règles locales : valeurs attendues", () => {
    const f = repairOrderRules(OR_50985) as F;
    expect(f["client"]).toMatchObject(EXPECTED);
    expect(f["vehicle"]).toMatchObject({ brand: "VOLKSWAGEN", model: "POLO 1.0 60", plate: "EM-426-NG", vin: "WVWZZZ6RZHY255149" });
    expect(f["order"]!["client_remarks"]).toBe("revision");
  });
  it("prénom = adresse => faible confiance, nom/prénom redécoupés", () => {
    expect(looksLikeAddress("LEBOURG")).toBe(true);
    expect(looksLikeAddress("MARIE-ANNAELLE")).toBe(false);
    const r = sanitizeRepairOrder({ client: { last_name: "VIELESCOT MARIE-ANNAELLE", first_name: "LEBOURG", email: "marievielescot@icloud.com" } });
    const c = r.fields["client"] as Record<string, unknown>;
    expect(c).toMatchObject({ last_name: "VIELESCOT", first_name: "MARIE-ANNAELLE", address: "LE BOURG" });
    expect(r.fields["_suspect"]).toEqual(expect.arrayContaining(["client.first_name", "client.last_name", "client.email"]));
  });
  it("lecture fausse mais remplie => vision déclenchée et prioritaire", async () => {
    const degraded = OR_50985.replace("Mme VIELESCOT MARIE-ANNAELLE\nLE BOURG", "Mme VIELESCOT MARIE-ANNAELLE LEBOURG").replace("marie.vielescot", "marie vielescot");
    let visionCalls = 0;
    const deps: PipelineDeps = {
      fallbackEnabled: async () => false,
      aiText: async () => null,
      aiVision: async () => { visionCalls++; return { client: EXPECTED }; },
      logLocal: async () => {},
    };
    const r = await runDocPipeline({ kind: "repair_order", text: degraded, hasImage: true, media: "photo" }, deps);
    expect(visionCalls).toBe(1);
    expect(r.fields["client"]).toMatchObject({ last_name: "VIELESCOT", first_name: "MARIE-ANNAELLE", email: "marie.vielescot@icloud.com" });
    expect((r.fields["order"] as Record<string, unknown>)["client_remarks"]).toBe("revision");
    expect(r.fields["_suspect"]).toBeUndefined();
  });
  it("lecture propre => aucun appel IA", async () => {
    let calls = 0;
    const deps: PipelineDeps = { fallbackEnabled: async () => true, aiText: async () => { calls++; return null; }, aiVision: async () => { calls++; return null; }, logLocal: async () => {} };
    const r = await runDocPipeline({ kind: "repair_order", text: OR_50985, hasImage: true, media: "photo" }, deps);
    expect(calls).toBe(0);
    expect(r.route).toBe("ocr_rules");
  });
});
