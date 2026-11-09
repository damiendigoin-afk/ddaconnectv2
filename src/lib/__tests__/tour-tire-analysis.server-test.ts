import { beforeEach, describe, expect, it, vi } from "vitest";
import { TOUR_TIRE_KEYS } from "../tour-tire-analysis";

vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({ middleware() { return this; }, inputValidator() { return this; }, handler(fn: unknown) { return fn; } }) }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
const paid = vi.hoisted(() => vi.fn());
vi.mock("../ai-usage.server", () => ({ runPaidAi: paid, dailyBudgetStatus: async () => ({}) }));
vi.mock("../ocr.server", () => ({ parseJsonBlock: JSON.parse }));
import { analyzeTourTires } from "../tour-tire-analysis.functions";

const points = TOUR_TIRE_KEYS.map((key) => ({ id: key, point_key: key }));
const media = points.flatMap((p) => ["Bande", "Flanc", "Dimension"].map((label) => ({ id: `${p.id}-${label}`, inspection_point_id: p.id, storage_path: `${p.id}/${label}.png`, label })));
const response = JSON.stringify({ wheels: Object.fromEntries(TOUR_TIRE_KEYS.map((key) => [key, { depth: { inner_mm: 5 }, sidewall: { size: "205/55 R16" } }])) });
function fixture() {
  const download = vi.fn(() => { throw new Error("Original photo download must not happen"); });
  const sign = vi.fn(async (path: string) => ({ data: { signedUrl: `https://storage.test/${path}?token=secret` }, error: null }));
  const mutation = vi.fn(() => { throw new Error("No business writes"); });
  const supabase = {
    rpc: vi.fn(async () => ({ data: true })),
    from: vi.fn((table: string) => {
      const q = { select: () => q, eq: () => q, in: () => q, order: () => q, insert: mutation, update: mutation, delete: mutation, then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: table === "inspection_points" ? points : media, error: null }).then(resolve) };
      return q;
    }),
    storage: { from: () => ({ download, createSignedUrl: sign, remove: mutation }) },
  };
  const call = analyzeTourTires as unknown as (arg: unknown) => Promise<{ ok: boolean; error?: string }>;
  return { download, sign, mutation, run: (force = false) => call({ data: { inspectionId: "test-tour", force }, context: { userId: "test-user", supabase } }) };
}
beforeEach(() => { vi.clearAllMocks(); paid.mockResolvedValue({ ok: true, content: response, cached: false, credits: 0, durationMs: 10, tokensIn: 10, tokensOut: 10 }); });
describe("Tour tyres production memory regression", () => {
  it("sends twelve signed references, never downloads or encodes the 42 MB originals", async () => {
    const f = fixture();
    expect((await f.run()).ok).toBe(true);
    expect(f.download).not.toHaveBeenCalled();
    expect(f.sign).toHaveBeenCalledTimes(12);
    const input = paid.mock.calls[0]?.[0];
    const images = input.body.messages[0].content.filter((c: { type: string }) => c.type === "image_url");
    expect(images).toHaveLength(12);
    expect(JSON.stringify(input.body).length).toBeLessThan(20_000);
    expect(f.mutation).not.toHaveBeenCalled();
  });
  it("storage failure returns a clear error, no AI call and no photo changes; retry reuses media", async () => {
    const f = fixture();
    f.sign.mockRejectedValueOnce(new Error("storage unavailable https://storage.test/?token=secret"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await f.run();
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain("token=");
    expect(paid).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("token=secret");
    expect((await f.run()).ok).toBe(true);
    expect(f.mutation).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it("ordinary retry retains the same fingerprint and uses cache", async () => {
    const f = fixture();
    await f.run(); await f.run();
    expect(paid.mock.calls[0]?.[0].fingerprintSeed).toBe(paid.mock.calls[1]?.[0].fingerprintSeed);
    expect(paid.mock.calls[1]?.[0].bypassCache).toBe(false);
    expect(f.mutation).not.toHaveBeenCalled();
  });
});