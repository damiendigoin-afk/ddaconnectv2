import { describe, expect, it } from "vitest";

import { detectMonth, detectSite, ImportError, parseSheet, parseWorkbookSheets, toNumber } from "@/lib/activity/parse";
import { aggregateKey, combineByPeriod, variation } from "@/lib/activity/series";
import { autoStatus, frenchHolidays, monthProgress } from "@/lib/activity/workdays";
import type { MonthData } from "@/lib/activity/store";

const ddaSheet: unknown[][] = [
  ["Société SAS DAMIEN DIGOIN AUTOMOBILE"],
  ["Rubrique", "Mois", "Cumul"],
  ["MO Mécanique", 12000, 90000],
  ["C.A. M.O.", 15000, 100000],
  ["Heures facturées", 320, 2400],
  ["Heures achetées", 400, 3000],
  ["Assurance", 0, 0],
  ["Loyer bâtiment", "", ""],
  ["Rubrique inconnue maison", 42],
];

const castiSheet: unknown[][] = [
  ["Société SAS CASTILLON-VEYSSIERE"],
  ["C.A. M.O.", "8 000,50 €"],
  ["Heures facturées", 100],
  ["Heures achetées", 200],
];

describe("détection société et mois", () => {
  it("reconnaît DDA depuis l'en-tête société", () => {
    expect(detectSite(ddaSheet)).toBe("dda");
  });
  it("reconnaît Castillon depuis l'en-tête société", () => {
    expect(detectSite(castiSheet)).toBe("castillon");
  });
  it("refuse un classeur sans société identifiable", () => {
    expect(() => parseWorkbookSheets([{ name: "X0826", rows: [["Total", 1]] }])).toThrow(ImportError);
  });
  it("déduit le mois du nom d'onglet", () => {
    expect(detectMonth("DDA0826", [])).toBe("2026-08-01");
    expect(detectMonth("CASTI0126", [])).toBe("2026-01-01");
    expect(detectMonth("Synthèse", [["Août 2026"]])).toBe("2026-08-01");
  });
});

describe("lecture des valeurs", () => {
  it("vide reste NULL, zéro reste zéro", () => {
    const { month, anomalies } = parseSheet("DDA0826", ddaSheet, "dda");
    expect(month?.values["ch_assurance"]).toBe(0);
    expect(month?.values["ch_loyer_batiment"]).toBeNull();
    expect(anomalies.some((a) => a.label === "Loyer bâtiment" && a.kind === "missing")).toBe(true);
  });
  it("anomalie précise société → onglet → rubrique", () => {
    const { anomalies } = parseSheet("DDA0826", ddaSheet, "dda");
    expect(anomalies[0]?.message).toContain("DDA / Lalinde → DDA0826 → Loyer bâtiment");
  });
  it("convertit les montants formatés sans inventer de valeur", () => {
    expect(toNumber("8 000,50 €")).toBe(8000.5);
    expect(toNumber("")).toBeNull();
    expect(toNumber("n/a")).toBeNull();
    expect(toNumber(0)).toBe(0);
    expect(toNumber("12,5 %")).toBeCloseTo(0.125);
  });
  it("ignore les libellés hors référentiel sans casser l'import", () => {
    const parsed = parseWorkbookSheets([{ name: "DDA0826", rows: ddaSheet }]);
    expect(parsed.site).toBe("dda");
    expect(parsed.months).toHaveLength(1);
    expect(parsed.months[0]?.values["mo_mecanique"]).toBe(12000);
  });
});

function md(site: string, period: string, values: Record<string, number | null>): MonthData {
  return {
    month: {
      id: `${site}-${period}`,
      site_code: site,
      period_start: period,
      sheet_name: null,
      status: "provisoire",
      status_manual: false,
      created_at: "",
      updated_at: "",
    },
    values: new Map(Object.entries(values)),
  };
}

describe("agrégation et comparatifs", () => {
  const data = [
    md("dda", "2026-08-01", { ca_total: 100, heures_facturees: 300, heures_achetees: 400 }),
    md("castillon", "2026-08-01", { ca_total: 50, heures_facturees: 100, heures_achetees: 100 }),
    md("dda", "2025-08-01", { ca_total: 80 }),
  ];

  it("vue Groupe = somme des deux sites", () => {
    const points = combineByPeriod(data);
    const aug = points.find((p) => p.periodStart === "2026-08-01");
    expect(aug?.values.get("ca_total")).toBe(150);
    expect(aug?.sites).toBe(2);
  });

  it("réalisation recalculée sur les totaux", () => {
    const points = combineByPeriod(data).filter((p) => p.periodStart === "2026-08-01");
    expect(aggregateKey(points, "realisation")).toBeCloseTo(0.8);
  });

  it("comparatif N-1 et absence de faux pourcentage", () => {
    const points = combineByPeriod(data);
    const cur = aggregateKey(points.filter((p) => p.periodStart === "2026-08-01"), "ca_total");
    const prev = aggregateKey(points.filter((p) => p.periodStart === "2025-08-01"), "ca_total");
    expect(variation(cur, prev)).toBeCloseTo(0.875);
    expect(variation(cur, null)).toBeNull();
    expect(variation(cur, 0)).toBeNull();
  });

  it("un ancien exercice incomplet ne casse pas la lecture", () => {
    const points = combineByPeriod(data).filter((p) => p.periodStart === "2025-08-01");
    expect(aggregateKey(points, "heures_facturees")).toBeNull();
  });
});

describe("jours ouvrés France", () => {
  it("intègre les jours fériés", () => {
    expect(frenchHolidays(2026).has("2026-05-01")).toBe(true);
    // mai 2026 : 21 jours lundi-vendredi, moins 1er mai, 8 mai, Ascension (14/05) et Pentecôte (25/05)
    expect(monthProgress("2026-05-01", new Date(2026, 4, 31)).total).toBe(17);
  });
  it("avancement du mois", () => {
    const p = monthProgress("2026-09-01", new Date(2026, 8, 15));
    expect(p.elapsed).toBeGreaterThan(0);
    expect(p.remaining).toBe(p.total - p.elapsed);
    expect(p.ratio).toBeCloseTo(p.elapsed / p.total);
  });
  it("statut automatique du mois", () => {
    expect(autoStatus("2026-09-01", new Date(2026, 8, 15))).toBe("en_cours");
    expect(autoStatus("2026-08-01", new Date(2026, 8, 15))).toBe("provisoire");
    expect(autoStatus("2026-08-01", new Date(2026, 8, 26))).toBe("consolide");
    expect(autoStatus("2026-01-01", new Date(2026, 8, 1))).toBe("consolide");
  });
});
