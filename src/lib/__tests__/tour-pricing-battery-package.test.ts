import { describe, expect, it } from "vitest";

import { priceBatteryReplacement } from "../tour-pricing";
import type { EngineContext, ServicePackage } from "../pricing-engine";
import { buildVehicleProfile } from "../vehicle-profile";

const pkg = (over: Partial<ServicePackage>): ServicePackage =>
  ({
    id: over.id ?? "p1",
    active: true,
    brand: "Renault",
    model: null,
    segment: null,
    energies: [],
    hours: null,
    label: "Forfait",
    notes: null,
    operation_code: "RMPNB1",
    parts_ht: null,
    price_basis: "ttc",
    price_ht: null,
    price_ttc: null,
    rate_code: "taux_2",
    year_from: null,
    year_to: null,
    created_at: "",
    updated_at: "",
    dedupe_key: null,
    imported_at: null,
    imported_by: null,
    source_file_name: null,
    source_kind: null,
    source_page: null,
    source_version: null,
    ...over,
  }) as ServicePackage;

const ctx = (packages: ServicePackage[]) =>
  ({
    pricing: {
      grid: { id: "g", name: "DDA 2026", effective_from: "2026-01-01" },
      rates: [
        {
          id: "t2",
          grid_id: "g",
          category: "labor",
          code: "taux_2",
          label: "Taux 2",
          amount_ht: 74.9,
          amount_ttc: 89.88,
          unit: "heure",
          sort_order: 0,
          created_at: "",
          updated_at: "",
        },
      ],
    },
    packages,
    paintRules: [],
    settings: { margin_pct: 35, min_margin_ht: 15 },
  }) as unknown as EngineContext;

const captur = buildVehicleProfile({ brand: "Renault", model: "CAPTUR DCI 90", energy: "diesel" } as never);

describe("chiffrage batterie — priorité au forfait Renault", () => {
  it("utilise le forfait batterie Renault du référentiel plutôt que le fallback", () => {
    const item = priceBatteryReplacement({
      ctx: ctx([
        pkg({ id: "rev", label: "REV RENAULT CLASSIQUE", price_ttc: 255 }),
        pkg({
          id: "bat",
          label: "CONTROLE ET REMPLACEMENT BATTERIE",
          operation_code: "RMPNB7",
          model: "Captur",
          price_ttc: 189,
        }),
      ]),
      vehicle: captur,
      label: "Batterie — remplacement batterie",
      priority: "a_remplacer",
      detail: "SOH 69 %",
      test: { verdict: "a_remplacer", cca_rated: 720 } as never,
      originPointKey: "batterie",
    });

    expect(item.needsContact).toBe(false);
    expect(item.source).toBe("forfait_renault");
    expect(item.totalTtc).toBe(189);
    expect(item.label).toMatch(/BATTERIE/i);
    expect((item.computation as Record<string, unknown>)["method"]).toBe("forfait_batterie_referentiel");
  });

  it("signale un choix manuel quand plusieurs forfaits batterie correspondent", () => {
    const item = priceBatteryReplacement({
      ctx: ctx([
        pkg({ id: "b1", label: "REMPLACEMENT BATTERIE 60AH", price_ttc: 159 }),
        pkg({ id: "b2", label: "REMPLACEMENT BATTERIE 70AH", price_ttc: 189 }),
      ]),
      vehicle: captur,
      label: "Batterie — remplacement batterie",
      priority: "a_remplacer",
      detail: "",
      test: null,
      originPointKey: "batterie",
    });
    expect(item.source).toBe("forfait_renault");
    expect(item.totalTtc).toBeGreaterThan(0);
    expect(item.message).toMatch(/à sélectionner/i);
    expect(
      ((item.computation as Record<string, unknown>)["battery_package_choices"] as unknown[]).length,
    ).toBe(2);
  });

  it("retombe sur la proposition générique sans forfait batterie en base", () => {
    const item = priceBatteryReplacement({
      ctx: ctx([pkg({ id: "rev", label: "REV RENAULT CLASSIQUE", price_ttc: 255 })]),
      vehicle: captur,
      label: "Batterie — remplacement batterie",
      priority: "a_remplacer",
      detail: "",
      test: null,
      originPointKey: "batterie",
    });
    expect((item.computation as Record<string, unknown>)["method"]).toBe("proposition_generique_batterie");
  });

  it("rapproche un Captur I / QM3 70 Ah 720 A du forfait RSPNCC, jamais du Captur II", () => {
    const capturI = buildVehicleProfile({
      brand: "Renault",
      model: "CAPTUR DCI 90",
      energy: "diesel",
      firstRegistrationDate: "2014-07-21",
    } as never);
    const item = priceBatteryReplacement({
      ctx: ctx([
        pkg({
          id: "rspncc",
          operation_code: "RSPNCC",
          label: "REMPLACEMENT BATTERIE 70 AH 720 A (BATTERIE ET MAIN D'OEUVRE COMPRISES)",
          model: "CAPTUR I / QM3",
          notes: "Captur I / QM3 1.2 16V, 1.3 16V, 1.5 dCi, 1.6 16V",
          segment: "B",
          price_ttc: 389,
          year_from: 2013,
          year_to: 2019,
        }),
        pkg({
          id: "capturII",
          operation_code: "RSPNCD",
          label: "REMPLACEMENT BATTERIE 60 AH 640 A",
          model: "CAPTUR II",
          price_ttc: 329,
          year_from: 2019,
          year_to: 2030,
        }),
      ]),
      vehicle: capturI,
      label: "Batterie — remplacement batterie",
      priority: "a_remplacer",
      detail: "SOH 69 %",
      test: { verdict: "a_remplacer", cca_rated: 720, capacity_ah: 70 } as never,
      originPointKey: "batterie",
    });
    expect(item.needsContact).toBe(false);
    expect(item.source).toBe("forfait_renault");
    expect(item.totalTtc).toBe(389);
    expect(item.message).not.toMatch(/à sélectionner/i);
  });
});
