import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));

import { saveTourTirePressureChecked } from "../tour-tire-persistence";

type Row = { id: string; tire_analysis: unknown; updated_at: string };

function fakeDatabase(initial: Row) {
  const row = structuredClone(initial);
  let writes = 0;
  let beforeWrite: (() => void) | null = null;
  let writeError: { message: string } | null = null;

  mocks.from.mockImplementation((table: string) => {
    if (table !== "inspection_points") throw new Error(`table inattendue: ${String(table)}`);
    return {
      select: () => {
        const filters: Record<string, unknown> = {};
        const query = {
          eq(field: string, value: unknown) { filters[field] = value; return query; },
          async single() {
            return filters["id"] === row.id
              ? { data: structuredClone(row), error: null }
              : { data: null, error: { message: "introuvable" } };
          },
        };
        return query;
      },
      update: (patch: Record<string, unknown>) => {
        const filters: Record<string, unknown> = {};
        const query = {
          eq(field: string, value: unknown) { filters[field] = value; return query; },
          is(field: string, value: unknown) { filters[field] = value; return query; },
          select: () => ({
            async maybeSingle() {
              writes += 1;
              if (writeError) return { data: null, error: writeError };
              beforeWrite?.();
              beforeWrite = null;
              if (filters["id"] !== row.id || filters["updated_at"] !== row.updated_at) return { data: null, error: null };
              Object.assign(row, structuredClone(patch));
              return { data: { id: row.id }, error: null };
            },
          }),
        };
        return query;
      },
    };
  });
  return {
    row,
    writes: () => writes,
    conflictOnce(patch: Partial<Row>) { beforeWrite = () => Object.assign(row, structuredClone(patch)); },
    failWrites() { writeError = { message: "écriture refusée" }; },
  };
}

beforeEach(() => {
  mocks.from.mockClear();
});

describe("persistance pression — JSON frais et concurrence", () => {
  it("préserve analyse, référence et corrections lors du cochage puis du décochage", async () => {
    const db = fakeDatabase({
      id: "avg",
      updated_at: "2026-11-16T10:00:00.000Z",
      tire_analysis: { ai: { depth_mm: 4 }, confirmedRef: "205/55 R16 91V", corrections: [{ reason: "contrôle" }] },
    });
    await saveTourTirePressureChecked("avg", true);
    expect(db.row.tire_analysis).toMatchObject({ pressure_checked: true, ai: { depth_mm: 4 }, confirmedRef: "205/55 R16 91V" });
    await saveTourTirePressureChecked("avg", false);
    expect(db.row.tire_analysis).toMatchObject({ pressure_checked: false, ai: { depth_mm: 4 }, corrections: [{ reason: "contrôle" }] });
  });

  it("une analyse arrivée entre lecture et écriture est relue, jamais écrasée par le vieux snapshot", async () => {
    const db = fakeDatabase({ id: "avd", updated_at: "v1", tire_analysis: { ai: { model: "ancien" } } });
    db.conflictOnce({ updated_at: "v2", tire_analysis: { ai: { model: "nouveau" }, globalMetrics: { cache: false } } });
    await saveTourTirePressureChecked("avd", true);
    expect(db.writes()).toBe(2);
    expect(db.row.tire_analysis).toMatchObject({ pressure_checked: true, ai: { model: "nouveau" }, globalMetrics: { cache: false } });
  });

  it("accepte un ancien JSON nul et remonte toute erreur Supabase", async () => {
    const old = fakeDatabase({ id: "arg", updated_at: "v1", tire_analysis: null });
    await saveTourTirePressureChecked("arg", true);
    expect(old.row.tire_analysis).toEqual({ pressure_checked: true });

    const failed = fakeDatabase({ id: "ard", updated_at: "v1", tire_analysis: {} });
    failed.failWrites();
    await expect(saveTourTirePressureChecked("ard", true)).rejects.toThrow("écriture refusée");
  });
});
