import { describe, expect, it } from "vitest";
import { decideOrScan } from "../or-scan-decision";

describe("decideOrScan (bouton caméra Atelier)", () => {
  it("ouvre l'OR connu unique", () => {
    expect(decideOrScan({ or_number: "50890", plate: "HG-732-GH", orIds: ["a"] })).toEqual({ kind: "open_or", orId: "a" });
  });
  it("OR inconnu + plaque => recherche plaque avec note, aucun OR créé", () => {
    const d = decideOrScan({ or_number: "99999", plate: "HG-732-GH", orIds: [] });
    expect(d.kind).toBe("plate");
    if (d.kind === "plate") expect(d.note).toContain("aucun OR créé");
  });
  it("plaque seule => recherche plaque", () => {
    expect(decideOrScan({ or_number: null, plate: "HG-732-GH", orIds: [] })).toEqual({ kind: "plate", plate: "HG-732-GH", note: null });
  });
  it("rien lu => note manuelle", () => {
    expect(decideOrScan({ or_number: null, plate: null, orIds: [] }).kind).toBe("note");
  });
  it("OR ambigu sans plaque => note", () => {
    expect(decideOrScan({ or_number: "1", plate: null, orIds: ["a", "b"] }).kind).toBe("note");
  });
});
