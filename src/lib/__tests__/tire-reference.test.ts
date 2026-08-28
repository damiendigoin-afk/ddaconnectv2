import { describe, expect, it } from "vitest";

import { parseTireReference } from "@/lib/tires";

describe("parseTireReference", () => {
  it("reconnaît une référence complète", () => {
    const r = parseTireReference("195/55 R16 87H");
    expect(r.complete).toBe(true);
    expect(r.size).toBe("195/55R16");
    expect(r.load).toBe("87");
    expect(r.speed).toBe("H");
    expect(r.display).toBe("195/55 R16 87H");
  });

  it("accepte les variantes d'écriture", () => {
    expect(parseTireReference("205/55r16 91v").display).toBe("205/55 R16 91V");
    expect(parseTireReference("225/45ZR17 94Y XL").marks).toContain("XL");
  });

  it("marque comme partielle une dimension sans indices", () => {
    const r = parseTireReference("195/55 R16");
    expect(r.size).toBe("195/55R16");
    expect(r.complete).toBe(false);
    expect(r.load).toBeNull();
    expect(r.speed).toBeNull();
  });

  it("renvoie une lecture vide pour une saisie invalide", () => {
    const r = parseTireReference("pneu usé");
    expect(r.size).toBeNull();
    expect(r.complete).toBe(false);
    expect(r.display).toBe("");
  });
});
