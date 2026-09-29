import { describe, expect, it } from "vitest";
import { decideOrScan, interpretEnsure } from "../or-scan-decision";

describe("decideOrScan (Atelier)", () => {
  it("OR lu => ouverture/création de la fiche locale, avec immat", () => {
    expect(decideOrScan({ or_number: "16991", plate: "HG-732-GH" })).toEqual({ kind: "ensure", or_number: "16991", plate: "HG-732-GH" });
  });
  it("OR lu sans immat => ensure sans immat (jamais inventée)", () => {
    expect(decideOrScan({ or_number: "16991", plate: null })).toEqual({ kind: "ensure", or_number: "16991", plate: null });
  });
  it("plaque seule => recherche plaque", () => {
    expect(decideOrScan({ or_number: null, plate: "HG-732-GH" })).toEqual({ kind: "plate", plate: "HG-732-GH", note: null });
  });
  it("rien lu => note manuelle", () => {
    expect(decideOrScan({ or_number: null, plate: null }).kind).toBe("note");
  });
  it("numéro non WinMotor ignoré", () => {
    expect(decideOrScan({ or_number: "12", plate: null }).kind).toBe("note");
  });
});

describe("interpretEnsure", () => {
  it("OR absent de repair_orders => fiche créée puis ouverte", () => {
    expect(interpretEnsure("16991", { id: "x", created: true })).toEqual({ kind: "open", orId: "x", created: true });
  });
  it("second scan => même fiche rouverte, sans création", () => {
    expect(interpretEnsure("16991", { id: "x", created: false })).toEqual({ kind: "open", orId: "x", created: false });
  });
  it("immat manquante => demande l'immat, ne crée rien", () => {
    expect(interpretEnsure("16991", { needs_plate: true }).kind).toBe("needs_plate");
  });
  it("plus de message « attendez/importez »", () => {
    const r = interpretEnsure("16991", { error: "site_required" });
    expect(JSON.stringify(r)).not.toMatch(/attendez|importez/);
  });
});
