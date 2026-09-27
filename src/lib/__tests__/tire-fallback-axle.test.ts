import { describe, expect, it } from "vitest";

import { buildSevenOffers } from "../tires";
import { axleMonteLabel, axlesIdentical, consolidateAxles, readingsFromPoints } from "../tire-axle";
import { groupTireAxles, normalizeSevenChoices, totalSelectedTireGroups, type TireQuoteComputation } from "../tour-tire-groups";

type Args = Parameters<typeof buildSevenOffers>[0];
const settings = { margin_pct: 0, min_margin_ht: 0, tire_mount_price_ht: 16.67 } as unknown as Args["settings"];
const brands = [
  ["entree", "Sailun", 1], ["entree", "Linglong", 2],
  ["milieu", "Kleber", 1], ["milieu", "Hankook", 2], ["milieu", "Falken", 3],
  ["haut", "Michelin", 1], ["haut", "Goodyear", 2], ["haut", "Continental", 3],
].map(([tier, brand, sort_order]) => ({ tier, brand, sort_order, active: true, is_default: sort_order === 1 })) as unknown as Args["brands"];
const tire = (id: string, brand: string, season: string, ttc: number) =>
  ({
    id, active: true, brand, model: `${brand} M`, size: "155/65R14", season, tier: "",
    load_index: "75", speed_index: "T", price_kind: "public_ttc", purchase_price_ht: ttc,
    availability: null, supplier_key: "centralepneus", supplier_ref: id, consulted_at: null,
  }) as unknown as Args["offers"][number];
const run = (offers: Args["offers"], quantity = 2) =>
  buildSevenOffers({
    offers, brands, settings, quantity,
    mounted: { brand: null, model: null, size: "155/65R14", season: null },
    required: { size: "155/65R14", load: "75", speed: "T" },
  });

describe("repli par gamme", () => {
  it("chiffre Milieu Été avec Hankook quand Kleber été est absent", () => {
    const o = run([tire("k", "Kleber", "quatre_saisons", 70), tire("h", "Hankook", "ete", 65), tire("f", "Falken", "ete", 60)]);
    const s = o.find((x) => x.slot === "milieu_ete")!;
    expect(s.available).toBe(true);
    expect(s.brand).toBe("Hankook");
  });
  it("chiffre Haut avec Goodyear/Continental quand Michelin est absent", () => {
    const o = run([tire("g", "Goodyear", "ete", 90), tire("c", "Continental", "quatre_saisons", 95)]);
    expect(o.find((x) => x.slot === "haut_ete")!.brand).toBe("Goodyear");
    expect(o.find((x) => x.slot === "haut_quatre_saisons")!.brand).toBe("Continental");
  });
  it("reste indisponible si aucune marque de la gamme ne répond, sans prix inventé", () => {
    const s = run([tire("s", "Sailun", "ete", 50)]).find((x) => x.slot === "haut_ete")!;
    expect(s.available).toBe(false);
    expect(s.totalTtc).toBeNull();
  });
  it("garde 7 cases uniques et chiffre réellement 4 pneus", () => {
    const o2 = run([tire("s", "Sailun", "ete", 60)], 2);
    const o4 = run([tire("s", "Sailun", "ete", 60)], 4);
    expect(new Set(o4.map((x) => x.slot)).size).toBe(7);
    const e2 = o2.find((x) => x.slot === "entree_ete")!.totalTtc!;
    const e4 = o4.find((x) => x.slot === "entree_ete")!.totalTtc!;
    expect(e4).toBeCloseTo(e2 * 2, 1);
  });
  it("seule l'offre sélectionnée compte", () => {
    const offers = normalizeSevenChoices([], 4, "155/65 R14").map((x, i) => ({ ...x, available: true, totalTtc: 10 * (i + 1) }));
    const c = { method: "tour_tire_group", tire_group: true, group_key: "quatre", axles: ["avant", "arriere"], point_ids: [], size: "155/65 R14", quantity: 4, selected_slot: "identique", offers } as TireQuoteComputation;
    expect(totalSelectedTireGroups([c])).toBe(10);
  });
});

const an = (size: string | null, load = "75", speed = "T") => ({ ai: { size, load_index: load, speed_index: speed, confidence: { size: "elevee" } } });

describe("consolidation par essieu", () => {
  it("CW-862-AY : AV récupère 155/65R14 depuis AVG (OK) et fusionne en 4 pneus", () => {
    const points = [
      { id: "avg", point_key: "pneu_avg", tire_analysis: an("155/65R14") },
      { id: "avd", point_key: "pneu_avd", tire_analysis: null },
      { id: "arg", point_key: "pneu_arg", tire_analysis: an("155/65R14") },
      { id: "ard", point_key: "pneu_ard", tire_analysis: null },
    ];
    const media = ["avg", "avg", "avg", "arg", "arg", "arg"].map((p, i) => ({ id: `m${i}`, inspection_point_id: p }));
    const m = consolidateAxles(readingsFromPoints(points, media));
    expect(m.avant.size).toBe("155/65R14");
    expect(m.avant.load).toBe("75");
    expect(axleMonteLabel(m.avant)).toBe("155/65 R14 75T · confirmé par 3 photos");
    expect(axlesIdentical(m.avant, m.arriere)).toBe(true);
    const groups = groupTireAxles(
      [{ axle: "avant" as const, size: m.avant.size, value: 1 }, { axle: "arriere" as const, size: m.arriere.size, value: 2 }],
      axlesIdentical(m.avant, m.arriere),
    );
    expect(groups).toMatchObject([{ key: "quatre", quantity: 4 }]);
  });
  it("ne recopie jamais un essieu sur l'autre", () => {
    const m = consolidateAxles(readingsFromPoints([{ id: "avg", point_key: "pneu_avg", tire_analysis: an("155/65R14") }]));
    expect(m.arriere.size).toBeNull();
    expect(axlesIdentical(m.avant, m.arriere)).toBe(false);
  });
  it("marque un conflit et empêche la fusion", () => {
    const m = consolidateAxles(readingsFromPoints([
      { id: "a", point_key: "pneu_avg", tire_analysis: an("155/65R14") },
      { id: "b", point_key: "pneu_avd", tire_analysis: an("165/60R14") },
      { id: "c", point_key: "pneu_arg", tire_analysis: an("155/65R14") },
    ]));
    expect(m.avant.status).toBe("conflit");
    expect(m.avant.size).toBeNull();
    expect(axleMonteLabel(m.avant)).toContain("155/65R14 / 165/60R14");
    expect(axlesIdentical(m.avant, m.arriere)).toBe(false);
  });
  it("une seule lecture sans photo reste à confirmer", () => {
    const m = consolidateAxles(readingsFromPoints([{ id: "a", point_key: "pneu_arg", tire_analysis: an("155/65R14") }]));
    expect(m.arriere.status).toBe("propose");
  });
});
