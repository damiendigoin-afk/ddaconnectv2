import { describe, expect, it } from "vitest";

import { genericBatteryItem, groupTireItems, tireSizeOfPoint } from "../tour-pricing";
import type { EngineContext } from "../pricing-engine";

const ctx = {
  pricing: {
    grid: { id: "g", name: "DDA 2026", effective_from: "2026-01-01" },
    rates: [
      {
        id: "t2",
        grid_id: "g",
        category: "labor",
        code: "taux_2",
        label: "Taux 2",
        amount_ht: 74.9,
        amount_ttc: 89.88,
        unit: "heure",
        sort_order: 0,
        created_at: "",
        updated_at: "",
      },
    ],
  },
  packages: [],
  paintRules: [],
  settings: { margin_pct: 35, min_margin_ht: 15 },
} as unknown as EngineContext;

const tirePoint = (key: string) =>
  ({
    id: key,
    point_key: key,
    point_label: key === "pneu_avd" ? "Pneu AVD" : "Pneu AVG",
    status: "watch",
    comment: null,
    measure_value: 4,
    battery_test: null,
    tire_analysis: { confirmedRef: "205/60 R16 92H", ai: { size: "205/60R16" } },
  }) as never;

describe("chiffrage tour — cas Captur (batterie + 2 pneus à surveiller)", () => {
  it("propose une ligne batterie exploitable sans forfait référentiel", () => {
    const item = genericBatteryItem({
      ctx,
      label: "Batterie — remplacement batterie",
      priority: "urgent",
      detail: "SOH 69 %",
      test: { verdict: "a_remplacer", cca_rated: 720 } as never,
      originPointKey: "batterie",
    });
    expect(item.needsContact).toBe(true);
    expect(item.totalTtc).toBeGreaterThan(0);
    expect(item.originPointKey).toBe("batterie");
  });

  it("regroupe deux pneus à surveiller en une proposition « 2 pneus » avec dimension", () => {
    const items = groupTireItems(ctx, [
      { point: tirePoint("pneu_avd"), priority: "a_surveiller", offersReady: 0 },
      { point: tirePoint("pneu_avg"), priority: "a_surveiller", offersReady: 0 },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]!.quantity).toBe(2);
    expect(items[0]!.label).toContain("205/60 R16 92H");
  });

  it("garde la proposition pneus même sans dimension exploitable", () => {
    const blank = { ...(tirePoint("pneu_ard") as never), tire_analysis: null } as never;
    const items = groupTireItems(ctx, [{ point: blank, priority: "urgent", offersReady: 0 }]);
    expect(items[0]!.label).toContain("dimension à renseigner");
    expect(items[0]!.priority).toBe("urgent");
  });

  it("lit la dimension depuis la référence confirmée", () => {
    expect(tireSizeOfPoint({ confirmedRef: "205/60 R16 92H" })).toContain("205/60");
  });
});
