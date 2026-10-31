import { describe, expect, it } from "vitest";

import { suggestSite, type SiteWithCoords } from "@/lib/tire-web-sites";

const sites: SiteWithCoords[] = [
  { key: "castillon", lat: 44.8647, lng: 1.0841 },
  { key: "lalinde", lat: 44.858, lng: 0.7442 },
];

describe("garage le plus proche (site pneus)", () => {
  it("Sarlat => Castillon ; Bergerac => Lalinde", () => {
    expect(suggestSite(sites, { lat: 44.889, lng: 1.216 }, "postal").suggested).toBe("castillon");
    expect(suggestSite(sites, { lat: 44.853, lng: 0.483 }, "geolocation")).toMatchObject({ suggested: "lalinde", method: "geolocation" });
  });
  it("aucune information ou refus => Castillon par défaut", () => {
    expect(suggestSite(sites, null, "geolocation")).toMatchObject({ suggested: "castillon", method: "default" });
  });
  it("coordonnées d'un garage absentes => Castillon, aucune supposition", () => {
    expect(suggestSite([sites[0]!, { key: "lalinde", lat: null, lng: null }], { lat: 44.853, lng: 0.483 }, "postal").suggested).toBe("castillon");
  });
  it("position lointaine (> 150 km) => Castillon par défaut", () => {
    expect(suggestSite(sites, { lat: 48.85, lng: 2.35 }, "postal").method).toBe("default");
  });
});
