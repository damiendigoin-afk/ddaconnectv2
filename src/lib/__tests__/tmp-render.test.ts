import { it, vi } from "vitest";
import { writeFileSync, readFileSync } from "node:fs";
import { buildTireQuotePdf } from "@/lib/tire-quote-pdf";
import type { SevenOffer } from "@/lib/tires";
const base = (slot: string, o: Partial<SevenOffer> = {}): SevenOffer => ({ slot, kind: "gamme", title: slot, tier: slot.split("_")[0] as never, season: slot.split("_").slice(1).join("_") as never, available: true, unavailableReason: "", brand: "Michelin", model: "CrossClimate 2 Extra Load", size: "205/55R16", loadIndex: "91", speedIndex: "V", quantity: 2, unitSourceHt: 99, marginHt: 33, unitSellHt: 133, tiresHt: 266, tiresTtc: 319, mountLabel: "M", mountTtc: 40, totalHt: 300, totalVat: 60, totalTtc: 360.77, availability: null, compatibility: "compatible", compatibilityMessage: "", supplier: null, supplierRef: null, consultedAt: null, offerId: null, ...o });
it("render", async () => {
  vi.stubGlobal("fetch", async () => new Response(new Uint8Array(readFileSync("/tmp/logo.jpg")), { status: 200 }));
  const offers = [base("identique", { kind: "identique", tier: null, season: null, title: "Marque demandée Sailun" }), base("entree_ete", { brand: "Sailun", model: "Atrezzo Elite" }), base("entree_quatre_saisons", { available: false, unavailableReason: "Offre indisponible dans cette marque (Sailun)", brand: "Sailun" }), base("milieu_ete", { brand: "Kleber" }), base("milieu_quatre_saisons", { brand: "Kleber", model: "Quadraxer 3" }), base("haut_ete"), base("haut_quatre_saisons")];
  const blob = await buildTireQuotePdf({ site: null, siteLabel: "D.D.A. Saint-Cyprien", createdAt: "2026-09-11T09:00:00Z", userName: "Damien Digoin", size: "205/55R16", quantity: 2, requestedBrand: "Sailun", customerName: "Monsieur Dupont", plate: "AA-123-BB", vehicleLabel: "Renault Clio V", loadIndex: "91", speedIndex: "V" }, offers);
  writeFileSync("/tmp/quote.pdf", Buffer.from(await blob.arrayBuffer()));
});
