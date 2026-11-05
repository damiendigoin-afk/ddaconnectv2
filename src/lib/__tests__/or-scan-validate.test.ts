import { describe, expect, it } from "vitest";

import { sanitizeRepairOrder } from "../doc-rules";
import { assessOrScan, brandModelConflict, checkPlate, diffCritical, isPollutedModel, plateNearMiss, scoreRead, summarizeScores } from "../or-scan-validate";
import { interpretEnsure } from "../or-scan-decision";

const base = (vehicle: Record<string, unknown>, client: Record<string, unknown> = { last_name: "DUPONT" }, or = "50690") => ({ data: { client, vehicle, order: { or_number: or } }, orNumber: or });

describe("scan OR — régressions réelles", () => {
  it("plaque 50690 égale au n° d'OR : refusée et retirée", () => {
    expect(checkPlate("50690", { orNumber: "50690" })).toBe("or_number");
    expect(checkPlate("050690", { orNumber: "50690" })).toBe("or_number");
    const a = assessOrScan(base({ plate: "50690" }));
    expect(a.data.vehicle["plate"]).toBeUndefined();
    expect(a.doubts.find((d) => d.code === "plate_or_number")?.blocking).toBe(true);
    const s = sanitizeRepairOrder({ vehicle: { plate: "50690" }, order: { or_number: "50690" } });
    expect((s.fields["vehicle"] as Record<string, unknown>)["plate"]).toBeNull();
    expect(s.rejected).toContain("vehicle.plate");
  });

  it("BK-859-HQ / BK-859-HG : deux lectures différant d'une lettre => confirmation", () => {
    expect(plateNearMiss("BK-859-HQ", "BK859HG")).toBe(true);
    expect(plateNearMiss("BK-859-HG", "BK-859-HG")).toBe(false);
    const a = assessOrScan({ ...base({ plate: "BK-859-HQ" }), localPlate: "BK-859-HG" });
    expect(a.doubts.map((d) => d.code)).toContain("plate_two_readings");
    expect(a.data.vehicle["plate"]).toBe("BK-859-HQ");
  });

  it("RENAULT CEED : incohérence marque/modèle signalée, jamais corrigée", () => {
    expect(brandModelConflict("RENAULT", "CEED2 SPORT WAGON")).toBe("KIA");
    expect(brandModelConflict("RENAULT", "NAVARA")).toBe("NISSAN");
    expect(brandModelConflict("KIA", "CEED")).toBeNull();
    expect(brandModelConflict("RENAULT", "CLIO V")).toBeNull();
    const a = assessOrScan(base({ plate: "CX-528-KM", brand: "RENAULT", model: "CEED2 SPORT WAGON" }));
    expect(a.data.vehicle["brand"]).toBe("RENAULT");
    expect(a.doubts.find((d) => d.code === "brand_model")?.blocking).toBe(true);
    const s = sanitizeRepairOrder({ vehicle: { brand: "RENAULT", model: "CEED SW" } });
    expect(s.fields["_suspect"]).toEqual(expect.arrayContaining(["vehicle.brand", "vehicle.model"]));
  });

  it("modèle pollué par un e-mail : retiré (relecture ciblée)", () => {
    const m = "TRAFIC 1 CB LIHIP) MB emoil akocendre@hotmail.com_";
    expect(isPollutedModel(m)).toBe(true);
    expect(isPollutedModel("CLIO V")).toBe(false);
    expect(isPollutedModel("TRAFIC")).toBe(false);
    const s = sanitizeRepairOrder({ vehicle: { model: m } });
    expect((s.fields["vehicle"] as Record<string, unknown>)["model"]).toBeNull();
    expect(s.rejected).toContain("vehicle.model");
    expect(assessOrScan(base({ plate: "EY-499-DY", model: m })).data.vehicle["model"]).toBeUndefined();
  });

  it("client absent : avertissement non bloquant (contacts mis en attente)", () => {
    const a = assessOrScan(base({ plate: "AB-123-CD", brand: "RENAULT", model: "CLIO" }, { email: "x@y.fr" }));
    const d = a.doubts.find((x) => x.code === "client_missing");
    expect(d?.blocking).toBe(false);
  });

  it("lecture cohérente : aucune confirmation demandée", () => {
    expect(assessOrScan(base({ plate: "AB-123-CD", brand: "RENAULT", model: "CLIO V" })).doubts).toEqual([]);
  });

  it("format atypique (étranger, W garage) : vérifiable, pas refusé", () => {
    expect(checkPlate("W-123-AB")).toBe("atypical");
    expect(checkPlate("123 ABC 24")).toBe("ok");
    expect(assessOrScan(base({ plate: "D-AB1234" })).doubts[0]?.code).toBe("plate_atypical");
    expect(interpretEnsure("50690", { error: "plate_unconfirmed" }).kind).toBe("error");
  });

  it("corrections et scores champ par champ", () => {
    const read = { vehicle: { plate: "BK-859-HQ", model: "NAVARA" }, client: {}, order: { or_number: "17370" } };
    const ok = { vehicle: { plate: "BK-859-HG", model: "NAVARA" }, client: {}, order: { or_number: "17370" } };
    expect(diffCritical(read, ok)).toEqual(["vehicle.plate"]);
    const s = scoreRead(ok, read);
    expect(s["vehicle.plate"]).toBe("wrong");
    expect(s["vehicle.model"]).toBe("exact");
    expect(summarizeScores(s)).toMatchObject({ exact: 2, wrong: 1, scored: 3 });
  });
});
