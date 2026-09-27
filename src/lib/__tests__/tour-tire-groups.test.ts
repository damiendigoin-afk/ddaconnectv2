import { describe, expect, it } from "vitest";

import {
  STANDARD_TIRE_SLOTS,
  groupTireAxles,
  normalizeSevenChoices,
  totalSelectedTireGroups,
  type TireQuoteComputation,
} from "../tour-tire-groups";

describe("groupement pneus du Tour véhicule", () => {
  it("propose 2 pneus pour l'avant seul", () => {
    expect(groupTireAxles([{ axle: "avant", size: "205/55 R16", value: "avd" }])).toMatchObject([
      { key: "avant", quantity: 2, axles: ["avant"] },
    ]);
  });

  it("propose 2 pneus pour l'arrière seul", () => {
    expect(groupTireAxles([{ axle: "arriere", size: "205/55 R16", value: "arg" }])).toMatchObject([
      { key: "arriere", quantity: 2, axles: ["arriere"] },
    ]);
  });

  it("fusionne avant et arrière de même dimension en 4 pneus", () => {
    expect(groupTireAxles([
      { axle: "avant", size: "205/55 R16", value: "avd" },
      { axle: "arriere", size: "205/55R16", value: "arg" },
    ])).toMatchObject([{ key: "quatre", quantity: 4, axles: ["avant", "arriere"] }]);
  });

  it("conserve deux blocs pour des dimensions différentes", () => {
    expect(groupTireAxles([
      { axle: "avant", size: "205/55 R16", value: "avd" },
      { axle: "arriere", size: "225/45 R17", value: "arg" },
    ]).map((group) => group.quantity)).toEqual([2, 2]);
  });

  it("produit exactement les 7 slots standard sans alternative hiver", () => {
    const offers = normalizeSevenChoices([], 2, "205/55 R16");
    expect(offers.map((offer) => offer.slot)).toEqual(STANDARD_TIRE_SLOTS);
    expect(offers.slice(1).every((offer) => offer.season === "ete" || offer.season === "quatre_saisons")).toBe(true);
  });

  it("ne compte que l'offre sélectionnée dans chaque bloc", () => {
    const computation = {
      method: "tour_tire_group",
      tire_group: true,
      group_key: "avant",
      axles: ["avant"],
      point_ids: ["p1"],
      size: "205/55 R16",
      quantity: 2,
      selected_slot: "entree_ete",
      offers: normalizeSevenChoices([], 2, "205/55 R16").map((offer, index) => ({
        ...offer,
        available: true,
        totalTtc: 100 + index,
      })),
    } as TireQuoteComputation;
    expect(totalSelectedTireGroups([computation])).toBe(101);
  });
});