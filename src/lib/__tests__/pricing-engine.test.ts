import { describe, expect, it } from "vitest";

import {
  contactItem,
  blockTotals,
  findPackage,
  priceBodywork,
  priceMechanical,
  type EngineContext,
  type ServicePackage,
  type PaintElementRule,
} from "../pricing-engine";
import { buildVehicleProfile, deduceSegment, normalizeEnergy, operationCompatibility } from "../vehicle-profile";
import { applyMargin, checkTireSize, tireAgeFromDot, tireQuantity } from "../tires";

const rate = (code: string, ht: number, ttc: number, category = "labor") =>
  ({
    id: code,
    grid_id: "g",
    category,
    code,
    label: code,
    amount_ht: ht,
    amount_ttc: ttc,
    unit: "heure",
    sort_order: 0,
    created_at: "",
    updated_at: "",
  }) as never;

const paintRule = (over: Partial<PaintElementRule>): PaintElementRule =>
  ({
    id: over.element_key ?? "r",
    element_key: "porte_avant",
    label: "Porte avant",
    element_size: "moyen",
    paint_hours: 1.5,
    repair_hours_default: 1,
    dr_operations: [],
    active: true,
    created_at: "",
    updated_at: "",
    ...over,
  }) as PaintElementRule;

const ctx: EngineContext = {
  pricing: {
    grid: { id: "g", name: "DDA 2026", effective_from: "2026-01-01" } as never,
    rates: [
      rate("taux_2", 74.9, 89.88),
      rate("igp_opaque", 49.9, 59.88, "igp"),
      rate("geometrie", 82.5, 99, "service"),
    ],
  },
  packages: [],
  paintRules: [paintRule({}), paintRule({ element_key: "aile_arriere", label: "Aile arrière", element_size: "gros", paint_hours: 2, repair_hours_default: 1 })],
  settings: { margin_pct: 35, min_margin_ht: 15 } as never,
};

const clio = buildVehicleProfile({ brand: "Renault", model: "Clio", energy: "Essence", firstRegistrationDate: "2020-05-01" });

describe("profil véhicule", () => {
  it("déduit le segment sans demander de tranche d'âge", () => {
    expect(deduceSegment("Clio")).toBe("B");
    expect(deduceSegment("Master")).toBe("utilitaire");
    expect(deduceSegment("Golf")).toBe("C");
  });
  it("normalise l'énergie", () => {
    expect(normalizeEnergy("DIESEL")).toBe("diesel");
    expect(normalizeEnergy("E-Tech plug-in")).toBe("hybride_rechargeable");
    expect(normalizeEnergy("électrique")).toBe("electrique");
  });
  it("bloque les forfaits incohérents", () => {
    expect(operationCompatibility("revision", "electrique").compatible).toBe(false);
    expect(operationCompatibility("filtre_gazole", "essence").compatible).toBe(false);
    expect(operationCompatibility("plaquettes_av", "electrique").compatible).toBe(true);
  });
});

describe("chiffrage mécanique", () => {
  it("utilise la grille atelier pour une prestation forfaitaire", () => {
    const item = priceMechanical(ctx, { operationCode: "geometrie", label: "Géométrie", vehicle: clio });
    expect(item.ok).toBe(true);
    expect(item.totalTtc).toBe(99);
    expect(item.source).toBe("grille_atelier");
  });
  it("affiche « Nous contacter » sans forfait fiable", () => {
    const item = priceMechanical(ctx, { operationCode: "distribution", vehicle: clio });
    expect(item.needsContact).toBe(true);
    expect(item.message).toBe("Nous contacter pour le devis");
  });
  it("retient un forfait équivalent par segment pour une autre marque", () => {
    const pkg = {
      id: "p1",
      brand: "renault",
      segment: "B",
      model: "clio",
      energies: ["essence"],
      operation_code: "revision",
      label: "Révision",
      hours: 1,
      parts_ht: 80,
      price_ttc: null,
      rate_code: "taux_2",
      year_from: null,
      year_to: null,
      notes: null,
      active: true,
      created_at: "",
      updated_at: "",
    } as ServicePackage;
    const withPkg: EngineContext = { ...ctx, packages: [pkg] };
    const peugeot = buildVehicleProfile({ brand: "Peugeot", model: "208", energy: "essence", firstRegistrationDate: "2021-01-01" });
    const match = findPackage(withPkg, "revision", peugeot);
    expect(match?.source).toBe("equivalent_multimarques");
    const item = priceMechanical(withPkg, { operationCode: "revision", vehicle: peugeot });
    expect(item.totalHt).toBeCloseTo(154.9, 2);
  });
});

describe("carrosserie", () => {
  it("chiffre une porte avec colorimétrie et IGP", () => {
    const item = priceBodywork(ctx, { elementKey: "porte_avant", severity: "leger", paintType: "opaque" });
    // 1 h réparation + 1,5 h peinture + 1 h colorimétrie = 3,5 h MO ; IGP = 2,5 h
    expect(item.hours).toBeCloseTo(3.5, 2);
    expect(item.totalHt).toBeCloseTo(3.5 * 74.9 + 2.5 * 49.9, 2);
  });
  it("classe l'aile arrière en gros élément à 2 h de peinture", () => {
    const item = priceBodywork(ctx, { elementKey: "aile_arriere", severity: "modere", paintType: "opaque" });
    expect((item.computation as { paint_hours: number }).paint_hours).toBe(2);
  });
  it("renvoie un contrôle carrossier sur choc lourd", () => {
    const item = priceBodywork(ctx, { elementKey: "porte_avant", severity: "lourd", paintType: "opaque" });
    expect(item.needsContact).toBe(true);
    expect(item.message).toBe("Contrôle carrossier nécessaire");
  });
});

describe("politique commerciale et pneus", () => {
  it("applique MAX(pourcentage, marge mini)", () => {
    expect(applyMargin(100, { margin_pct: 35, min_margin_ht: 15 } as never).sellHt).toBe(135);
    expect(applyMargin(20, { margin_pct: 35, min_margin_ht: 15 } as never).sellHt).toBe(35);
  });
  it("compte les pneus selon le constat", () => {
    expect(tireQuantity("avant")).toBe(2);
    expect(tireQuantity("quatre")).toBe(4);
  });
  it("signale une dimension à vérifier", () => {
    expect(checkTireSize("205/55 R16", "205/55R16").status).toBe("conforme");
    expect(checkTireSize("225/45R17", "205/55R16").status).toBe("a_verifier");
    expect(checkTireSize("205/55R16", null).status).toBe("inconnue");
  });
  it("déduit l'âge du pneu depuis le DOT", () => {
    expect(tireAgeFromDot("DOT XX 1218")?.alert).toBe(true);
  });
});

describe("totaux par bloc", () => {
  it("sépare mécanique, carrosserie et esthétique", () => {
    const items = [
      priceMechanical(ctx, { operationCode: "geometrie", label: "Géométrie", vehicle: clio }),
      priceBodywork(ctx, { elementKey: "porte_avant", severity: "leger", paintType: "opaque" }),
      contactItem({ label: "Rénovation optique", block: "esthetique" }),
    ];
    const t = blockTotals(items);
    expect(t.blocks.mecanique.items).toHaveLength(1);
    expect(t.blocks.carrosserie.items).toHaveLength(1);
    expect(t.pendingContact).toBe(1);
    expect(t.totalTtc).toBeGreaterThan(99);
  });
});
