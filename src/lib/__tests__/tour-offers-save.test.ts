import { describe, expect, it } from "vitest";

import { offerRows } from "../tour-recompute";
import { isIncompleteLine, lineFromItem } from "../quotes";
import type { SevenOffer } from "../tires";
import type { PricedItem } from "../pricing-engine";

const offer = (over: Partial<SevenOffer>): SevenOffer =>
  ({
    slot: "s1",
    kind: "gamme",
    title: "Offre",
    tier: null,
    season: null,
    available: false,
    unavailableReason: "",
    brand: null,
    model: null,
    size: "205/60 R16 92H",
    loadIndex: null,
    speedIndex: null,
    quantity: 2,
    unitSourceHt: null,
    marginHt: null,
    unitSellHt: null,
    tiresHt: null,
    tiresTtc: null,
    mountLabel: null,
    mountTtc: null,
    totalHt: null,
    totalVat: null,
    totalTtc: null,
    availability: null,
    compatibility: "identique",
    compatibilityMessage: "",
    supplier: null,
    supplierRef: null,
    consultedAt: null,
    offerId: null,
    ...over,
  }) as SevenOffer;

describe("enregistrement des offres de chiffrage", () => {
  it("produit des lignes aux clés identiques (insert groupé accepté)", () => {
    const rows = offerRows([offer({ consultedAt: "2026-09-01T10:00:00Z" }), offer({ consultedAt: null })], {
      inspectionId: "i1",
      pointId: "p1",
      wheelCode: "avd",
      selectedSlot: null,
    });
    const keys = rows.map((r) => Object.keys(r).sort().join(","));
    expect(new Set(keys).size).toBe(1);
    expect(rows.every((r) => r.consulted_at)).toBe(true);
  });

  it("renseigne consulted_at sur les offres fallback AVG/AVD (contrainte NOT NULL)", () => {
    const fallback = offer({ available: false, unavailableReason: "Nous contacter pour le devis", consultedAt: null });
    for (const wheel of ["avg", "avd"]) {
      const rows = offerRows([fallback], {
        inspectionId: "i1",
        pointId: `p-${wheel}`,
        wheelCode: wheel,
        selectedSlot: null,
      });
      expect(rows[0]!.consulted_at).toBeTruthy();
      expect(rows[0]!.kind).toBeTruthy();
      expect(rows[0]!.quantity).toBeGreaterThan(0);
      expect(rows[0]!.selected).toBe(false);
    }
  });

  it("enregistre une ligne incomplète en la marquant à compléter", () => {
    const item = {
      ok: false,
      needsContact: true,
      message: "Prix pneu à compléter",
      label: "2 pneus — dimension à renseigner",
      detail: "",
      block: "mecanique",
      priority: "a_surveiller",
      quantity: 2,
      hours: null,
      unitHt: null,
      totalHt: 0,
      totalTtc: 0,
      source: "saisie_manuelle",
      confidence: "faible",
      computation: { method: "proposition_generique_pneus" },
      originPointKey: "pneu_avd",
    } as unknown as PricedItem;
    expect(isIncompleteLine(item)).toBe(true);
    const line = lineFromItem(item, 0);
    expect(line.total_ht).toBe(0);
    expect(line.quantity).toBe(2);
    expect((line.computation as unknown as { a_completer: boolean }).a_completer).toBe(true);
    expect(line.detail).toBe("Prix pneu à compléter");
  });
});
