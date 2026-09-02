import { describe, expect, it } from "vitest";

import { isoDate, isoTimestamp } from "@/lib/datetime";
import { formatPlate, latinizePlate, normalizePlate } from "@/lib/plate";
import { normalizeRegistration } from "@/lib/winmotor/mapping";
import { oppositeWheel } from "@/lib/tires";

describe("plaques et claviers cyrilliques", () => {
  it("convertit les sosies cyrilliques en latin", () => {
    expect(latinizePlate("АВ-123-СЕ")).toBe("AB-123-CE");
    expect(normalizePlate("АВ-123-СЕ")).toBe("AB123CE");
    expect(formatPlate("АВ123СЕ")).toBe("AB-123-CE");
    expect(normalizeRegistration("ФТ-469-ТН".replace("Ф", "F"))).toBe("FT469TH");
  });

  it("ne casse pas les plaques latines existantes", () => {
    expect(normalizePlate("FT-469-TN")).toBe("FT469TN");
    expect(normalizePlate("1234 AB 75")).toBe("1234AB75");
  });
});

describe("normalisation des dates indépendante du format régional", () => {
  it("accepte la valeur native date et le secours régional", () => {
    expect(isoDate("2026-09-02")).toBe("2026-09-02");
    expect(isoDate("02/09/2026")).toBe("2026-09-02");
    expect(isoDate("")).toBeNull();
  });

  it("convertit datetime-local en timestamp ISO", () => {
    const ts = isoTimestamp("2026-09-02T08:30");
    expect(ts).toMatch(/^2026-09-02T\d{2}:30/);
    expect(isoTimestamp("")).toBeNull();
  });
});

describe("essieu pneumatique", () => {
  it("retourne la roue opposée du même essieu", () => {
    expect(oppositeWheel("avg")).toBe("avd");
    expect(oppositeWheel("avd")).toBe("avg");
    expect(oppositeWheel("arg")).toBe("ard");
    expect(oppositeWheel("ard")).toBe("arg");
    expect(oppositeWheel("secours")).toBeNull();
  });
});
