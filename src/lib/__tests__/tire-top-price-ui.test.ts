import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/routes/devis.pneus.index.tsx", "utf8");

describe("Écran devis pneus : Top prix uniquement dans le sélecteur Fournisseur", () => {
  it("option Top prix dans le select, sans bouton ni sélecteur de saison séparés", () => {
    expect(src).toContain('<option value={TOP_PRICE_OPTION}>Top prix</option>');
    expect(src).not.toMatch(/aria-pressed=\{topPrice\}|topSeason|moins cher par gamme|Chiffrer Top prix/);
    expect(src).toContain('"Chiffrer (7 offres)" : "Chiffrer (6 offres)"');
  });
});
