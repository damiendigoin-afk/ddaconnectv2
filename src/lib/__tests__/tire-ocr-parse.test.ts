import { describe, expect, it } from "vitest";
import { consolidateWheelOcr, parseTireText, wheelOcrSummary } from "../tire-ocr-parse";

describe("parsing OCR flanc", () => {
  it("lit dimensions et indices", () => {
    expect(parseTireText("155/65 R14 75T")).toMatchObject({ size: "155/65R14", load: "75", speed: "T", complete: true });
    expect(parseTireText("xx 205/55R16 91V XL")).toMatchObject({ size: "205/55R16", load: "91", speed: "V", xl: true });
    expect(parseTireText("225/45 ZR17 94W")).toMatchObject({ size: "225/45R17", load: "94", speed: "W" });
    expect(parseTireText("2O5/55 R1б")).toMatchObject({ size: null });
    expect(parseTireText("2O5/55R16 9lV").size).toBe("205/55R16");
  });
  it("rejette les valeurs impossibles", () => {
    expect(parseTireText("123/45 R14").size).toBeNull();
    expect(parseTireText("DOT 3419").size).toBeNull();
  });
  it("indices séparés de la dimension", () => {
    expect(parseTireText("155/65R14\n75T")).toMatchObject({ load: "75", speed: "T" });
  });
  it("saisons", () => {
    expect(parseTireText("KLEBER QUADRAXER 3").season).toBe("quatre_saisons");
    expect(parseTireText("VECTOR 4SEASONS").season).toBe("quatre_saisons");
    expect(parseTireText("ALL SEASON M+S").season).toBe("quatre_saisons");
    expect(parseTireText("M+S 3PMSF")).toMatchObject({ season: "quatre_saisons", ms: true, pmsf: true });
    expect(parseTireText("COOPER WEATHERMASTER WINTER").season).toBe("hiver");
    expect(parseTireText("M+S").season).toBeNull();
  });
  it("marques et modèles sans faux positif", () => {
    expect(parseTireText("GOODYEAR VECTOR 4SEASONS G2")).toMatchObject({ brand: "Goodyear", model: "Vector 4Seasons G2" });
    expect(parseTireText("MICHELIN CROSSCLIMATE 2").brand).toBe("Michelin");
    expect(parseTireText("SOLIUN").brand).toBeNull();
    expect(parseTireText("TUBELESS RADIAL").brand).toBeNull();
  });
});

describe("consolidation photo 2 + photo 3", () => {
  const p = (t: string) => parseTireText(t);
  it("concordance => confirmé ; photo 2 complète la marque", () => {
    const w = consolidateWheelOcr(p("COOPER 155/65R14"), p("155/65 R14 75T"));
    expect(w).toMatchObject({ size: "155/65R14", load: "75", speed: "T", brand: "Cooper", confidence: "confirme" });
    expect(wheelOcrSummary(w)).toBe("155/65 R14 75T · Cooper");
  });
  it("photo 3 complète prime en cas de désaccord", () => {
    expect(consolidateWheelOcr(p("165/60R14"), p("155/65R14 75T")).size).toBe("155/65R14");
  });
  it("photo 3 incomplète => conflit à confirmer", () => {
    const w = consolidateWheelOcr(p("165/60R14 79H"), p("155/65R14"));
    expect(w.confidence).toBe("conflit");
    expect(w.size).toBeNull();
  });
  it("lecture unique structurée / aucune", () => {
    expect(consolidateWheelOcr(null, p("155/65R14 75T")).confidence).toBe("structure");
    expect(consolidateWheelOcr(null, null).confidence).toBe("aucune");
  });
});
