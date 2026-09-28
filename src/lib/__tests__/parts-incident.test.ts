import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("@/integrations/supabase/client", () => {
  const chain = () => { const c: Record<string, unknown> = {}; for (const k of ["update", "insert", "eq", "select", "single"]) c[k] = () => c; (c as { then: unknown }).then = (r: (v: unknown) => void) => r({ data: null, error: null }); return c; };
  return { supabase: { from: (t: string) => { calls.push(t); return chain(); }, rpc: () => chain() } };
});

describe("Signaler incident", () => {
  it("ne crée aucun mouvement de stock", async () => {
    const { cancelReceiptIncident } = await import("@/lib/parts");
    await cancelReceiptIncident("r1", "s1", "livré au mauvais site", { userId: "u", name: "Test" } as never);
    expect(calls).toEqual(["part_receipts", "parts_events"]);
    expect(calls).not.toContain("stock_movements");
  });
});
