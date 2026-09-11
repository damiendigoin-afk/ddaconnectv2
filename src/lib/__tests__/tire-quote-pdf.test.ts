/**
 * Maquette PDF devis pneus : on vérifie uniquement la PRÉSENTATION
 * (1 page A4, logo du projet embarqué, aucune donnée interne imprimée).
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { PDFDocument } from "pdf-lib";

import ddaRenaultLogo from "@/assets/dda-renault-logo.jpeg.asset.json";
import { buildTireQuotePdf, type TireQuotePdfHeader } from "@/lib/tire-quote-pdf";
import type { SevenOffer } from "@/lib/tires";

const header: TireQuotePdfHeader = {
  site: null,
  siteLabel: "D.D.A. Saint-Cyprien",
  createdAt: "2026-09-11T09:00:00.000Z",
  userName: "Damien",
  size: "205/55R16",
  quantity: 2,
  requestedBrand: null,
  customerName: "Client Test",
  plate: "AA-123-BB",
  vehicleLabel: "Renault Clio",
  loadIndex: "91",
  speedIndex: "V",
};

function offer(slot: string, over: Partial<SevenOffer> = {}): SevenOffer {
  const [tier, ...rest] = slot.split("_");
  return {
    slot,
    kind: "gamme",
    title: slot,
    tier: tier as SevenOffer["tier"],
    season: rest.join("_") as SevenOffer["season"],
    available: true,
    unavailableReason: "",
    brand: "Michelin",
    model: "Primacy 4+",
    size: "205/55R16",
    loadIndex: "91",
    speedIndex: "V",
    quantity: 2,
    unitSourceHt: 99.99,
    marginHt: 33.33,
    unitSellHt: 133.32,
    tiresHt: 266.64,
    tiresTtc: 319.97,
    mountLabel: "Montage",
    mountTtc: 40.8,
    totalHt: 300.64,
    totalVat: 60.13,
    totalTtc: 360.77,
    availability: null,
    compatibility: "compatible",
    compatibilityMessage: "Compatible",
    supplier: null,
    supplierRef: null,
    consultedAt: null,
    offerId: null,
    ...over,
  };
}

const six: SevenOffer[] = [
  offer("entree_ete"),
  offer("entree_quatre_saisons", { available: false, unavailableReason: "Offre indisponible" }),
  offer("milieu_ete"),
  offer("milieu_quatre_saisons"),
  offer("haut_ete"),
  offer("haut_quatre_saisons"),
];

const seventh: SevenOffer = offer("identique", {
  kind: "identique",
  tier: null,
  season: null,
  title: "Marque demandée",
});

function mockLogoFetch() {
  const spy = vi.fn(async () => new Response(null, { status: 404 }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe("maquette PDF devis pneus", () => {
  it("génère un PDF A4 d'une seule page avec 6 offres", async () => {
    mockLogoFetch();
    const blob = await buildTireQuotePdf(header, six);
    expect(blob.type).toBe("application/pdf");
    const doc = await PDFDocument.load(await blob.arrayBuffer());
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
  });

  it("reste sur une seule page A4 avec la 7e offre marque demandée", async () => {
    mockLogoFetch();
    const blob = await buildTireQuotePdf(
      { ...header, requestedBrand: "Michelin" },
      [seventh, ...six],
    );
    const doc = await PDFDocument.load(await blob.arrayBuffer());
    expect(doc.getPageCount()).toBe(1);
  });

  it("utilise le logo existant du projet", async () => {
    const spy = mockLogoFetch();
    await buildTireQuotePdf(header, six);
    expect(spy).toHaveBeenCalledWith(ddaRenaultLogo.url);
  });

  it("n'imprime ni prix d'achat ni marge", async () => {
    mockLogoFetch();
    const blob = await buildTireQuotePdf(header, six);
    const text = new TextDecoder("latin1").decode(new Uint8Array(await blob.arrayBuffer()));
    expect(text).not.toContain("99,99");
    expect(text).not.toContain("33,33");
    expect(text).not.toContain("133,32");
    expect(text.toLowerCase()).not.toContain("marge");
  });

  it("affiche Indisponible pour une offre absente", async () => {
    mockLogoFetch();
    const blob = await buildTireQuotePdf(header, six);
    const text = new TextDecoder("latin1").decode(new Uint8Array(await blob.arrayBuffer()));
    expect(text).toContain("Indisponible");
  });
});
