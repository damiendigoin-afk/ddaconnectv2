import { describe, expect, it, vi } from "vitest";

import {
  logMileageFailure,
  normalizeCapturedFile,
  parseMileageInput,
  runStep,
} from "../mileage-capture";

/** Simule un retour appareil photo Pixel 7 (Chrome Android / PWA). */
function pixelPhoto(opts: { size: number; type?: string; name?: string }) {
  return {
    size: opts.size,
    type: opts.type ?? "",
    name: opts.name,
    slice: () => ({}),
  } as unknown as File;
}

describe("étape photo compteur — Pixel 7", () => {
  it("normalise une grande photo JPEG sans nom ni type", () => {
    const capture = normalizeCapturedFile(pixelPhoto({ size: 52 * 1024 * 1024 }));
    expect(capture).not.toBeNull();
    expect(capture!.type).toBe("image/jpeg");
    expect(capture!.extension).toBe("jpg");
    expect(capture!.name).toMatch(/^compteur-\d+\.jpg$/);
    expect(capture!.tooLarge).toBe(true);
  });

  it("accepte image/webp et conserve l'extension", () => {
    const capture = normalizeCapturedFile(pixelPhoto({ size: 1024, type: "image/webp", name: "IMG.webp" }));
    expect(capture!.extension).toBe("webp");
    expect(capture!.name).toBe("IMG.webp");
    expect(capture!.tooLarge).toBe(false);
  });

  it("refuse proprement un retour caméra vide (annulation Android)", () => {
    expect(normalizeCapturedFile(null)).toBeNull();
    expect(normalizeCapturedFile(undefined)).toBeNull();
    expect(normalizeCapturedFile(pixelPhoto({ size: 0 }))).toBeNull();
  });

  it("un échec OCR ne jette jamais et permet la reprise", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await runStep("ocr", async () => {
      throw new Error("gateway 500");
    });
    expect(failed.ok).toBe(false);
    const retried = await runStep("ocr", async () => ({ ok: true, mileage: 128450 }));
    expect(retried.ok).toBe(true);
    spy.mockRestore();
  });

  it("journalise l'étape fautive sans photo ni donnée personnelle", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logMileageFailure("upload", new Error("network"), { sizeMb: 51 });
    const payload = spy.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload["step"]).toBe("upload");
    expect(JSON.stringify(payload)).not.toMatch(/data:image|base64|\.jpg/);
    spy.mockRestore();
  });

  it("valide la saisie manuelle du kilométrage", () => {
    expect(parseMileageInput("128 450 km")).toBe(128450);
    expect(parseMileageInput(null)).toBeNull();
    expect(parseMileageInput("0")).toBeNull();
    expect(parseMileageInput("9999999")).toBeNull();
  });
});
