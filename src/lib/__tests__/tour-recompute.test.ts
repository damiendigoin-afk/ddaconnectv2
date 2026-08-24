import { describe, expect, it } from "vitest";

import { pickBestOffer } from "../tour-recompute";
import { mountPackageLevel0, requiredFromLabel, rimDiameterOf } from "../tires";
import type { ServicePackage } from "../pricing-engine";
import type { SevenOffer } from "../tires";

const label = {
  size_front: "215/65 R16",
  size_rear: null,
  load_index_front: "98",
  speed_index_front: "H",
  load_index_rear: null,
  speed_index_rear: null,
};

function offer(slot: string, kind: "identique" | "gamme", totalTtc: number | null, available: boolean): SevenOffer {
  return {
    slot,
    kind,
    title: slot,
    tier: null,
    season: null,
    available,
    unavailableReason: "",
    brand: null,
    model: null,
    size: "215/65R16",
    loadIndex: "98",
    speedIndex: "H",
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
    totalTtc,
    availability: null,
    compatibility: "compatible",
    compatibilityMessage: "Compatible",
    supplier: null,
    supplierRef: null,
    consultedAt: null,
    offerId: null,
  };
}

describe("recalcul d'un ancien tour", () => {
  it("exploite l'étiquette pneus enregistrée (FT346QS : 215/65R16 H)", () => {
    expect(requiredFromLabel(label, "avg")).toEqual({ size: "215/65 R16", load: "98", speed: "H" });
    // L'arrière retombe sur l'avant quand l'étiquette ne distingue pas les montes.
    expect(requiredFromLabel(label, "ard").size).toBe("215/65 R16");
  });

  it("ne fabrique aucune dimension sans étiquette", () => {
    expect(requiredFromLabel(null, "avg")).toEqual({ size: null, load: null, speed: null });
  });

  it("retient le forfait montage Renault niveau 0 correspondant au nombre de pneus", () => {
    expect(rimDiameterOf("215/65 R16")).toBe(16);
    const packages = [
      { operation_code: "RTPNE0", label: "Montage 1 pneu SSPP (niveau 0)", price_ttc: 39, active: true },
      { operation_code: "RTPNF0", label: "Montage 2 pneus SSPP (niveau 0)", price_ttc: 69, active: true },
      { operation_code: "RTPNG0", label: "Montage 4 pneus SSPP (niveau 0)", price_ttc: 129, active: true },
    ] as unknown as ServicePackage[];
    expect(mountPackageLevel0(packages, 2)).toEqual({
      label: "Montage 2 pneus SSPP (niveau 0)",
      unitTtc: 34.5,
      totalTtc: 69,
    });
    expect(mountPackageLevel0(packages, 1)?.totalTtc).toBe(39);
    expect(mountPackageLevel0(packages, 4)?.totalTtc).toBe(129);
  });


  it("retient l'offre identique, sinon la moins chère disponible", () => {
    const list = [offer("identique", "identique", 480, true), offer("entree_ete", "gamme", 320, true)];
    expect(pickBestOffer(list)?.slot).toBe("identique");
    const withoutIdentical = [
      offer("identique", "identique", null, false),
      offer("haut_ete", "gamme", 600, true),
      offer("entree_ete", "gamme", 320, true),
    ];
    expect(pickBestOffer(withoutIdentical)?.slot).toBe("entree_ete");
    expect(pickBestOffer([offer("identique", "identique", null, false)])).toBeNull();
  });
});
