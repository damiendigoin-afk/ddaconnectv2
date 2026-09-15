import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Notification Front Office à la clôture d'un Tour Véhicule :
 * - un échec de génération du PDF ne doit plus empêcher l'e-mail,
 * - la tentative déjà ouverte par la clôture est réutilisée (pas de doublon),
 * - une notification déjà envoyée ne repart pas une seconde fois.
 */

type Row = Record<string, unknown>;

const state = {
  alreadySent: false,
  inserts: [] as Array<{ table: string; values: Row }>,
  updates: [] as Array<{ table: string; values: Row }>,
  sends: [] as Array<{ to: string; attachments: unknown[]; html: string }>,
};

function builder(table: string) {
  const api: Record<string, unknown> = {};
  const chain = () => api as never;
  Object.assign(api, {
    select: chain,
    eq: chain,
    order: chain,
    or: chain,
    in: () => ({
      limit: async () => ({
        data:
          table === "tour_notifications" && state.alreadySent
            ? [{ recipients: ["fo@test.fr"], photo_count: 3 }]
            : [],
      }),
    }),
    limit: async () => ({ data: [] }),
    insert: (values: Row) => {
      state.inserts.push({ table, values });
      return {
        select: () => ({ single: async () => ({ data: { id: `${table}-id` }, error: null }) }),
        then: (r: (v: unknown) => unknown) => r({ error: null }),
      };
    },
    update: (values: Row) => {
      state.updates.push({ table, values });
      return { eq: async () => ({ error: null }) };
    },
    single: async () => {
      if (table === "vehicle_inspections") {
        return {
          data: {
            id: "tour-1",
            site_id: "site-1",
            status: "completed",
            vehicle: { id: "veh-1", plate: "AA-123-BB" },
            repair_order: { client: { first_name: "Jean", last_name: "Test" } },
          },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  });
  return api as never;
}

const sb = {
  from: (table: string) => {
    if (table === "tour_notification_recipients") {
      const rows = { data: [{ email: "fo@test.fr", site_id: "site-1" }], error: null };
      const api: Record<string, unknown> = {};
      Object.assign(api, {
        select: () => api,
        eq: () => api,
        or: () => Promise.resolve(rows),
        then: (r: (v: unknown) => unknown) => r(rows),
      });
      return api;
    }
    if (["inspection_points", "observations", "media", "vehicle_expertises"].includes(table)) {
      const rows = { data: [], error: null };
      const api: Record<string, unknown> = {};
      Object.assign(api, {
        select: () => api,
        eq: () => api,
        order: () => api,
        limit: () => Promise.resolve(rows),
        then: (r: (v: unknown) => unknown) => r(rows),
      });
      return api;
    }
    return builder(table);
  },
  storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) },
};

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: sb }));
vi.mock("../tour-pdf.server", () => ({
  tourLogoUrl: () => "https://example.test/logo.jpeg",
  buildTourPdf: async () => {
    throw new Error("pdf-lib indisponible");
  },
}));
vi.mock("../email.server", () => ({
  brandedEmail: (inner: string) => inner,
  emailButton: () => "",
  sendEmailWithAttachments: async (input: { to: string; attachments?: unknown[]; html: string }) => {
    state.sends.push({ to: input.to, attachments: input.attachments ?? [], html: input.html });
    return { ok: true, status: 200, id: "resend-1" };
  },
}));

import { notifyTourCompleted } from "../tour-notify.server";

beforeEach(() => {
  state.alreadySent = false;
  state.inserts = [];
  state.updates = [];
  state.sends = [];
});

describe("notification Front Office", () => {
  it("envoie l'e-mail même si le PDF ne peut pas être généré", async () => {
    const res = await notifyTourCompleted({
      inspectionId: "tour-1",
      origin: "https://ddaconnectv2.lovable.app",
      skipIfAlreadySent: true,
      mode: "automatic",
      logId: "log-1",
    });
    expect(res.ok).toBe(true);
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0]?.attachments).toHaveLength(0);
    expect(state.sends[0]?.to).toBe("fo@test.fr");
    // L'échec PDF reste tracé dans le journal du tour.
    const last = state.updates.filter((u) => u.table === "tour_notifications").at(-1);
    expect(String(last?.values["error_message"])).toContain("PDF");
  });

  it("réutilise la tentative ouverte par la clôture, sans créer de doublon", async () => {
    await notifyTourCompleted({
      inspectionId: "tour-1",
      origin: "https://ddaconnectv2.lovable.app",
      skipIfAlreadySent: true,
      mode: "automatic",
      logId: "log-1",
    });
    expect(state.inserts.filter((i) => i.table === "tour_notifications")).toHaveLength(0);
  });

  it("n'envoie pas deux fois la notification d'un tour déjà notifié", async () => {
    state.alreadySent = true;
    const res = await notifyTourCompleted({
      inspectionId: "tour-1",
      origin: "https://ddaconnectv2.lovable.app",
      skipIfAlreadySent: true,
      mode: "automatic",
      logId: "log-1",
    });
    expect(res.ok).toBe(true);
    expect(state.sends).toHaveLength(0);
    const last = state.updates.filter((u) => u.table === "tour_notifications").at(-1);
    expect(last?.values["status"]).toBe("skipped");
  });
});
