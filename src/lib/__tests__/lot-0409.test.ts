import { describe, expect, it } from "vitest";

import { groupTireItems } from "../tour-pricing";
import {
  estimateBodyworkLevel,
  estimateCleaningLevel,
  priceBodyworkLevel,
  priceCleaning,
  type EngineContext,
} from "../pricing-engine";

const ctx: EngineContext = {
  pricing: {
    grid: { id: "g", name: "DDA 2026", effective_from: "2026-01-01" } as never,
    rates: [
      {
        id: "taux_2",
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
      } as never,
    ],
  },
  packages: [],
  paintRules: [
    {
      id: "b",
      element_key: "bouclier_avant",
      label: "Pare-chocs avant",
      element_size: "gros",
      paint_hours: 2,
      repair_hours_default: 1.5,
      dr_operations: [],
      active: true,
      created_at: "",
      updated_at: "",
    } as never,
  ],
  settings: null,
};

const wheel = (key: string, label: string, size: string | null) => ({
  point: {
    id: key,
    point_key: key,
    point_label: label,
    status: "defect",
    comment: null,
    measure_value: null,
    battery_test: null,
    tire_analysis: size ? { confirmedRef: size } : null,
  },
  priority: "urgent" as const,
  offersReady: 0,
});

describe("pneus : raisonnement par essieu", () => {
  it("1 roue HS sur l'avant => 2 pneus", () => {
    const items = groupTireItems(ctx, [wheel("pneu_avg", "Pneu AVG", "205/60 R16 92H")]);
    expect(items).toHaveLength(1);
    expect(items[0]!.quantity).toBe(2);
    expect(items[0]!.label).toContain("2 pneus");
  });

  it("les deux essieux concernés => 4 pneus, jamais 3", () => {
    const items = groupTireItems(ctx, [
      wheel("pneu_avg", "Pneu AVG", "205/60 R16 92H"),
      wheel("pneu_avd", "Pneu AVD", "205/60 R16 92H"),
      wheel("pneu_arg", "Pneu ARG", "205/60 R16 92H"),
    ]);
    const quantities = items.map((i) => i.quantity);
    expect(quantities.reduce((a, b) => a + b, 0)).toBe(4);
    expect(quantities.some((q) => q === 1 || q === 3)).toBe(false);
  });

  it("dimensions différentes par essieu => 2 + 2", () => {
    const items = groupTireItems(ctx, [
      wheel("pneu_avg", "Pneu AVG", "205/60 R16 92H"),
      wheel("pneu_arg", "Pneu ARG", "215/55 R17 94V"),
    ]);
    expect(items.map((i) => i.quantity)).toEqual([2, 2]);
  });

  it("dimension inconnue : la ligne reste exploitable en 2 pneus", () => {
    const items = groupTireItems(ctx, [wheel("pneu_avd", "Pneu AVD", null)]);
    expect(items[0]!.quantity).toBe(2);
    expect(items[0]!.label).toContain("dimension à renseigner");
  });
});

describe("nettoyage : trois niveaux de forfait", () => {
  it("propose au minimum 39 € TTC", () => {
    const item = priceCleaning({ label: "Propreté intérieure", detail: "" });
    expect(item.totalTtc).toBe(39);
    expect(item.ok).toBe(true);
  });

  it("pré-estime le niveau quand le constat le permet", () => {
    expect(estimateCleaningLevel("véhicule très sale, poils de chien")).toBe("profond");
    expect(estimateCleaningLevel("intérieur sale")).toBe("standard");
    expect(estimateCleaningLevel("un peu sale")).toBe("leger");
    expect(estimateCleaningLevel("")).toBeNull();
    expect(priceCleaning({ label: "Propreté", detail: "très sale" }).totalTtc).toBe(199);
  });

  it("reste modifiable manuellement", () => {
    expect(priceCleaning({ label: "Propreté", level: "standard" }).totalTtc).toBe(79);
  });
});

describe("carrosserie : niveau d'intervention", () => {
  it("pare-chocs déclipsé => repose / fixation, pas de remplacement", () => {
    const item = priceBodyworkLevel(ctx, {
      elementKey: "bouclier_avant",
      detail: "pare-chocs déclipsé côté droit",
    });
    expect(item.label).toContain("repose / fixation");
    expect(item.needsContact).toBe(false);
    expect(item.computation["method"]).toBe("carrosserie_repose_fixation");
  });

  it("niveau incertain => choix laissé à l'utilisateur", () => {
    const item = priceBodyworkLevel(ctx, { elementKey: "bouclier_avant", detail: "constat à revoir" });
    expect(item.needsContact).toBe(true);
    expect(item.message).toContain("Niveau d'intervention à choisir");
  });

  it("redressage : aucun temps figé automatiquement", () => {
    const item = priceBodyworkLevel(ctx, { elementKey: "bouclier_avant", detail: "aile enfoncée" });
    expect(item.hours).toBeNull();
    expect(item.totalTtc).toBe(0);
    expect(item.message).toContain("Temps de redressage à saisir");
  });

  it("temps saisi par l'opérateur => ligne chiffrée", () => {
    const item = priceBodyworkLevel(ctx, {
      elementKey: "bouclier_avant",
      level: "redressage",
      repairHours: 2,
    });
    expect(item.totalTtc).toBeGreaterThan(0);
  });

  it("estimation prudente des niveaux", () => {
    expect(estimateBodyworkLevel("agrafe cassée, élément déclipsé")).toBe("mineur");
    expect(estimateBodyworkLevel("élément fissuré")).toBe("remplacement");
    expect(estimateBodyworkLevel("rien de précis")).toBeNull();
  });
});
