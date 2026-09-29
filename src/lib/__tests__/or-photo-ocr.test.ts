import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { orScanNeedsRetry, repairOrderRules } from "@/lib/doc-rules";
import { adaptiveBinarize } from "@/lib/doc-text.browser";
import { findFrenchPlate } from "@/lib/plate";

// Vraies sorties Tesseract (fra) d'une photo d'OR ombrée type téléphone.
const pass1 = readFileSync(join(__dirname, "fixtures/or-photo-pass1.txt"), "utf8");
const pass2 = readFileSync(join(__dirname, "fixtures/or-photo-pass2.txt"), "utf8");

describe("OR papier photographié", () => {
  it("1re passe seule : n° d'OR lu mais pas l'immat (cas production) -> 2e passe demandée", () => {
    const f = repairOrderRules(pass1) as Record<string, Record<string, unknown>>;
    expect(f["vehicle"]!["plate"]).toBeNull();
    expect(orScanNeedsRetry(pass1)).toBe(true);
  });
  it("avec la 2e passe binarisée : OR + immat + véhicule + client", () => {
    const f = repairOrderRules(`${pass1}\n${pass2}`) as Record<string, Record<string, unknown>>;
    expect(f["order"]!["or_number"]).toBe("16991");
    expect(f["vehicle"]!["plate"]).toBe("FR-418-KV");
    expect(f["vehicle"]!["brand"]).toBe("RENAULT");
    expect(f["client"]!["last_name"]).toBe("MARTIN");
  });
  it("immat : sosies OCR dans les chiffres corrigés, majorité entre passes", () => {
    expect(findFrenchPlate("FR-4I8-KV")).toBe("FR-418-KV");
    expect(findFrenchPlate("FR-418-KV\nFR-438-KV\nFR-418-KV")).toBe("FR-418-KV");
    expect(findFrenchPlate("FR-418-KV\nFR-438-KV")).toBeNull();
    expect(findFrenchPlate("DE LOS AB")).toBeNull();
  });
  it("binarisation adaptative : texte sombre sur fond dégradé", () => {
    const w = 10, g = [...Array(w)].map((_, x) => (x === 5 ? 60 : 180));
    const b = adaptiveBinarize(g, w, 1, 3);
    expect(b[5]).toBe(0);
    expect(b[0]).toBe(255);
  });
});
