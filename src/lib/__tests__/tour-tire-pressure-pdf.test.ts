import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTourPdf } from "../tour-pdf.server";

async function firstPageText(base64: string): Promise<string> {
  vi.unstubAllGlobals();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(Buffer.from(base64, "base64")) }).promise;
  const content = await (await doc.getPage(1)).getTextContent();
  return content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
}

afterEach(() => vi.unstubAllGlobals());

describe("PDF TDV — pression des quatre roues", () => {
  it("imprime une confirmation Oui et trois Non confirmée, sans valeur de pression", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    const keys = ["pneu_avg", "pneu_avd", "pneu_arg", "pneu_ard"];
    const res = await buildTourPdf({
      sb: { storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) } },
      insp: {},
      points: keys.map((key) => ({
        id: key,
        point_key: key,
        zone_label: "Pneus",
        point_label: key.replace("pneu_", "Pneu ").toUpperCase(),
        status: "ok",
        tire_analysis: { pressure_checked: key === "pneu_avd" },
      })),
      observations: [],
      media: [],
      plate: "AA-123-AA",
      clientName: "Test",
      inspectionId: "tour-pression",
      logoUrl: "https://x.test/logo.jpeg",
    });
    const text = await firstPageText(res.base64);
    expect(text).toContain("PRESSION DES PNEUS");
    expect(text).toContain("PNEU AVD : Pression verifiee : Oui");
    expect(text.match(/Pression verifiee : Non confirmee/g)).toHaveLength(3);
    expect(text).not.toMatch(/Pression.*[0-9](?:[,.][0-9])?\s*bar/i);
  });
});
