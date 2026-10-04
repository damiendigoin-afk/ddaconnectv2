import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { OR_SCAN_MODEL } from "../or-scan-model";

describe("modèle IA du scan OR", () => {
  it("Gemini 3.5 Flash", () => expect(OR_SCAN_MODEL).toBe("google/gemini-3.5-flash"));
  it("ocrRepairOrder transmet ce modèle au pipeline", () => {
    const src = readFileSync(join(__dirname, "../ocr.functions.ts"), "utf8");
    expect(src).toMatch(/viaPipeline\("repair_order", prompt, data, "ocr_or", undefined, OR_SCAN_MODEL\)/);
  });
});
