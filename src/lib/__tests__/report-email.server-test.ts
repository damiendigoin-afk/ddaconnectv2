import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportActor } from "../report-access.server";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), send: vi.fn(), authMiddleware: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: mocks.admin } }));
vi.mock("../email.server", () => ({
  sendEmail: mocks.send,
  brandedEmail: (s: string) => s,
  emailButton: (_: string, url: string) => url,
}));
// Keep middleware composition executable, rather than bypassing authentication.
vi.mock("@tanstack/react-start", () => ({
  createMiddleware: () => ({ server: (fn: unknown) => fn }),
  createServerFn: () => {
    let middleware: Array<(arg: unknown) => unknown> = [];
    return {
      middleware(items: typeof middleware) {
        middleware = items;
        return this;
      },
      inputValidator() {
        return this;
      },
      handler(fn: (arg: unknown) => unknown) {
        return (args: Record<string, unknown>) => {
          const run = (i: number): unknown =>
            middleware[i] ? middleware[i]({ ...args, next: () => run(i + 1) }) : fn(args);
          return run(0);
        };
      },
    };
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: mocks.authMiddleware,
}));
import { sendTourReportEmail } from "../report-email.server";
import { sendTourReport } from "../report-email.functions";
import { sendExpertiseReportEmail } from "../expertise-email.server";
import { authorizeReport } from "../report-access.server";

const inspectionId = "a9cd512d-a32f-45a0-9ffb-ea0ddbcffcac";
const args = {
  inspectionId,
  to: "client@example.test",
  origin: "https://ddaconnectv2.lovable.app",
  message: "Message client",
};
type Result = { data: unknown; error: null | { code: string; message: string } };
function query(result: Result, writes?: Array<unknown>) {
  const q = {
    select: () => q,
    eq: () => q,
    in: () => q,
    order: () => q,
    insert: (v: unknown) => {
      writes?.push(v);
      return q;
    },
    update: (v: unknown) => {
      writes?.push(v);
      return q;
    },
    single: async () => result,
    maybeSingle: async () => result,
    then: (resolve: (v: Result) => unknown) => Promise.resolve(result).then(resolve),
  };
  return q;
}
function fixture(
  options: {
    active?: boolean;
    module?: boolean;
    site?: boolean;
    missing?: boolean;
    hidden?: boolean;
    userError?: string;
    adminError?: boolean;
    controlsError?: boolean;
    manager?: boolean;
  } = {},
) {
  const writes: unknown[] = [];
  const rpc = vi.fn(async (name: string) => ({
    data:
      name === "is_active_user"
        ? options.active !== false
        : name === "has_role"
          ? options.manager === true
          : options.site !== false,
    error: null,
  }));
  const from = vi.fn((table: string) =>
    query({
      data:
        table === "user_module_access"
          ? options.module === false
            ? []
            : [{ module_key: "tour", allowed: true }]
          : options.missing || options.hidden
            ? null
            : { id: inspectionId, site_id: "garage" },
      error:
        options.userError && table !== "user_module_access"
          ? { code: options.userError, message: "DB detailed failure" }
          : null,
    }),
  );
  mocks.admin.mockImplementation((table: string) =>
    query(
      {
        data:
          table === "email_logs"
            ? { id: "log" }
            : table === "inspection_points"
              ? [
                  {
                    zone_label: "Avant",
                    point_label: "Pneu",
                    status: "watch",
                    measure_value: 4,
                    measure_unit: "mm",
                    comment: "",
                    client_comment: "Contrôle client",
                  },
                ]
              : table === "observations"
                ? []
                : options.missing
                  ? null
                  : {
                      id: inspectionId,
                      site_id: "garage",
                      share_token: "share",
                      mileage: 50000,
                      vehicle: { plate: "GY-640-HM", brand: "Renault", model: "Austral" },
                      repair_order: {
                        or_number: "17007",
                        client: { first_name: "Test", last_name: "Client" },
                      },
                    },
        error:
          options.adminError && table === "vehicle_inspections"
            ? { code: "08006", message: "Connection failed" }
            : options.controlsError && table === "inspection_points"
              ? { code: "42501", message: "RLS refusal" }
              : null,
      },
      writes,
    ),
  );
  const actor = { userId: "operator", supabase: { rpc, from } } as unknown as ReportActor;
  return { actor, writes, rpc, from, run: () => sendTourReportEmail({ ...args, actor }) };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockResolvedValue({ ok: true, status: 200, id: "provider-id" });
  mocks.authMiddleware.mockImplementation(async ({ context, next }) => {
    if (!context?.userId) throw new Error("Unauthorized: No authorization header provided");
    return next();
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
describe("Client report email security and production regression", () => {
  it("authorized active operator sends the actual client report through admin after user/site checks", async () => {
    const f = fixture();
    const result = await f.run();
    expect(result).toMatchObject({ ok: true, id: "provider-id" });
    expect(f.rpc).toHaveBeenCalledWith("user_can_access_site", {
      _user_id: "operator",
      _site_id: "garage",
    });
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send.mock.calls[0]?.[0]).toMatchObject({
      to: "client@example.test",
    });
    expect(f.writes).toContainEqual(
      expect.objectContaining({ status: "sent", provider_id: "provider-id" }),
    );
    expect(f.writes).toContainEqual(
      expect.objectContaining({ last_sent_to: "client@example.test" }),
    );
    expect(f.rpc.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.admin.mock.invocationCallOrder[0] ?? 0,
    );
  });
  it("unauthenticated endpoint rejects with 401 before admin/read/send and logs rejection", async () => {
    const call = sendTourReport as unknown as (args: unknown) => Promise<unknown>;
    await expect(call({ data: args, context: {} })).rejects.toMatchObject({ status: 401 });
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "[report-email]",
      expect.objectContaining({ stage: "authentication", status: 401 }),
    );
  });
  it("direct server helper cannot bypass identity", async () => {
    const f = fixture();
    f.actor.userId = "";
    expect(await f.run()).toMatchObject({ ok: false, code: "unauthenticated", status: 401 });
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("disabled account is denied before privileged access", async () => {
    const f = fixture({ active: false });
    expect(await f.run()).toMatchObject({ ok: false, code: "forbidden", status: 403 });
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("unknown ID is 404, not a database or send failure", async () => {
    const f = fixture({ missing: true });
    expect(await f.run()).toMatchObject({ ok: false, code: "not_found", status: 404 });
    expect(f.writes).toHaveLength(0);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
  it("explicit RLS refusal is 403 and never escalated", async () => {
    const f = fixture({ userError: "42501" });
    expect(await f.run()).toMatchObject({ ok: false, code: "forbidden", status: 403 });
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("RLS-hidden existing row is 403; existence probe is never permission to send", async () => {
    const f = fixture({ hidden: true });
    expect(await f.run()).toMatchObject({ code: "forbidden", status: 403 });
    expect(f.writes).toHaveLength(0);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("wrong site is denied before admin use", async () => {
    const f = fixture({ site: false });
    expect(await f.run()).toMatchObject({ code: "forbidden", status: 403 });
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("missing menu permission is denied without elevation", async () => {
    const f = fixture({ module: false });
    expect(await f.run()).toMatchObject({ code: "forbidden", status: 403 });
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("database failure during initial load is logged and is not 404", async () => {
    const f = fixture({ adminError: true });
    expect(await f.run()).toMatchObject({ code: "database", status: 500 });
    expect(f.writes).toContainEqual(expect.objectContaining({ status: "failed" }));
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("control-load failure blocks sending a misleading empty report", async () => {
    const f = fixture({ controlsError: true });
    expect(await f.run()).toMatchObject({ code: "forbidden", status: 403 });
    expect(f.writes).toContainEqual(expect.objectContaining({ status: "failed" }));
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("provider refusal remains a send failure with no last-sent mutation", async () => {
    const f = fixture();
    mocks.send.mockResolvedValue({ ok: false, status: 503, error: "Provider unavailable" });
    expect(await f.run()).toMatchObject({ code: "send", status: 502 });
    expect(f.writes.some((v) => typeof v === "object" && v !== null && "last_sent_at" in v)).toBe(
      false,
    );
  });
  it("provider response without acceptance ID is not marked sent", async () => {
    const f = fixture();
    mocks.send.mockResolvedValue({ ok: true, status: 200 });
    expect(await f.run()).toMatchObject({ ok: false, code: "send", status: 502 });
    expect(f.writes.some((v) => typeof v === "object" && v !== null && "last_sent_at" in v)).toBe(false);
  });
  it("provider exception is journaled as send failure, not missing report", async () => {
    const f = fixture();
    mocks.send.mockRejectedValue(new Error("Network failure"));
    expect(await f.run()).toMatchObject({ ok: false, code: "send", status: 502 });
    expect(f.writes).toContainEqual(expect.objectContaining({ status: "failed" }));
  });
  it("expertise analogue rejects disabled users without reading privileged photos or sending", async () => {
    const f = fixture({ active: false });
    expect(
      await sendExpertiseReportEmail({ ...args, expertiseId: inspectionId, actor: f.actor }),
    ).toMatchObject({ code: "forbidden", status: 403 });
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("manager bypasses menu grant only, not active-account or site checks", async () => {
    const f = fixture({ manager: true, module: false });
    await expect(authorizeReport(f.actor, inspectionId, "tour")).resolves.toBeDefined();
    expect(f.from).not.toHaveBeenCalledWith("user_module_access");
  });
});
