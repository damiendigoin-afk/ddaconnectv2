import { describe, expect, it, vi } from "vitest";

import { buildTourPdf } from "../tour-pdf.server";

// JPEG 1x1 valide.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

describe("PDF Front Office serveur", () => {
  it("génère un PDF réel (%PDF) avec photos lisibles et ignore les illisibles", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("bad")) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      if (url.includes("logo")) return new Response("x", { status: 404 });
      return new Response(JPEG, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const sb = {
      storage: {
        from: () => ({
          createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://x.test/${p}` } }),
        }),
      },
    };
    const res = await buildTourPdf({
      sb,
      insp: { mileage: 12000 },
      points: [
        { id: "p1", zone_label: "Pneus", point_label: "Pneu ARG", status: "watch", measure_value: "NaN", measure_unit: "mm" },
      ],
      observations: [],
      media: [
        { id: "m1", storage_path: "ok1.jpg", inspection_point_id: "p1" },
        { id: "m2", storage_path: "bad.jpg" },
        { id: "m3", storage_path: "ok2.jpg" },
      ],
      plate: "CW-862-AY",
      clientName: "Test",
      inspectionId: "t1",
      logoUrl: "https://x.test/logo.jpeg",
    });
    vi.unstubAllGlobals();
    const bytes = Buffer.from(res.base64, "base64");
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(res.photoCount).toBe(2);
    expect(bytes.toString("latin1")).not.toContain("NaN");
  });
});
