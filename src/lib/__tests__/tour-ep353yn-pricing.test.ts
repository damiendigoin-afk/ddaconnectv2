import { describe, expect, it } from "vitest";
import { frontOfficeErrorMessage, frontOfficeIdempotencyKey, payloadFingerprint } from "../tour-notify-core";
import { legacyTireAnalysis, normalizeTireRequirement } from "../tour-tire-analysis";
import { buildTireGroupItems, priorityFromStatus, tireSizeOfPoint } from "../tour-pricing";
import type { TireStepResult } from "../tire-step";

const SIZE = "155/65 R14 75T";

function step(mm: number, cracks: boolean): TireStepResult {
  return {
    depth: { inner_mm: mm, center_mm: mm, outer_mm: mm, points_mm: [mm, mm, mm], confidence: "moyenne", gauge_visible: false, inner_side: null, note: "" },
    wear: { pattern: "reguliere", stronger_zone: null, wear_indicator: mm < 3 ? "non_visible" : "visible", cracks, deformation: false, facets: false, observations: cracks ? ["Craquelures visibles dans les rainures"] : [], recommendation: "" },
    sidewall: { brand: null, model: null, size: SIZE, load_index: null, speed_index: null, dot: null, read_quality: "bonne" },
  } as unknown as TireStepResult;
}

// Valeurs réellement persistées sur EP-353-YN (AVG 1 mm, AVD 4 mm craquelé, AR 6 mm).
const EP = { pneu_avg: [1, true, "defect"], pneu_avd: [4, true, "defect"], pneu_arg: [6, false, "ok"], pneu_ard: [6, false, "ok"] } as const;

function points(statuses: Record<string, string>) {
  return Object.entries(EP).map(([key, [mm, cracks]]) => ({
    id: key, point_key: key, point_label: key, status: statuses[key] ?? "ok", comment: null,
    measure_value: mm, battery_test: null, tire_analysis: legacyTireAnalysis(step(mm, cracks)),
  }));
}

function pending(statuses: Record<string, string>) {
  return points(statuses)
    .map((p) => ({ point: p, priority: priorityFromStatus(p.status), offersReady: 0 }))
    .filter((e) => e.priority) as never[];
}

describe("Tour EP-353-YN — chaînage analyse 4 pneus → chiffrage", () => {
  it("dimension stockée séparée en dimension + indices exploitables", () => {
    const a = legacyTireAnalysis(step(1, true));
    expect(a.ai.size).toBe("155/65R14");
    expect(a.ai.load_index).toBe("75");
    expect(a.ai.speed_index).toBe("T");
    expect(a.confirmedRef).toBe(SIZE);
    expect(tireSizeOfPoint(a)).toBe(SIZE);
    expect(a.grade).toBe("imperatif");
  });

  it("données anciennes (taille complète dans size) normalisées au chiffrage", () => {
    expect(normalizeTireRequirement({ size: SIZE, load: null, speed: null })).toEqual({ size: "155/65R14", load: "75", speed: "T" });
  });

  it("remplacement AV seul => 2 pneus", () => {
    const items = buildTireGroupItems(pending({ pneu_avg: "defect", pneu_avd: "defect" }), new Map());
    expect(items).toHaveLength(1);
    expect(items[0]!.quantity).toBe(2);
    expect(items[0]!.computation["size"]).toBe(SIZE);
  });

  it("un pneu AV + un pneu AR => 4 pneus", () => {
    const items = buildTireGroupItems(pending({ pneu_avg: "defect", pneu_ard: "defect" }), new Map());
    expect(items.reduce((s, i) => s + i.quantity, 0)).toBe(4);
  });

  it("aucun remplacement => aucune proposition pneus", () => {
    expect(buildTireGroupItems(pending({}), new Map())).toHaveLength(0);
  });
});

describe("Notification Front Office — idempotence", () => {
  const base = { inspectionId: "t1", recipient: "fo@garage.fr", mode: "automatic" as const };
  it("même contenu => même clé (retry dédoublonné)", () => {
    const p = payloadFingerprint(["sujet", "<p>a</p>"]);
    expect(frontOfficeIdempotencyKey({ ...base, payload: p })).toBe(frontOfficeIdempotencyKey({ ...base, payload: p }));
  });
  it("contenu modifié => clé différente (jamais 409)", () => {
    const k1 = frontOfficeIdempotencyKey({ ...base, payload: payloadFingerprint(["sujet", "<p>a</p>"]) });
    const k2 = frontOfficeIdempotencyKey({ ...base, payload: payloadFingerprint(["sujet", "<p>b</p>"]) });
    expect(k1).not.toBe(k2);
  });
  it("erreur fournisseur jamais affichée en JSON brut", () => {
    const raw = '{"message":"This idempotency key has been used...","name":"invalid_idempotent_request","statusCode":409}';
    const msg = frontOfficeErrorMessage(raw);
    expect(msg).not.toContain("{");
    expect(msg).toMatch(/aucun doublon/);
    expect(frontOfficeErrorMessage('{"statusCode":500,"name":"x"}')).toMatch(/code 500/);
  });
});
