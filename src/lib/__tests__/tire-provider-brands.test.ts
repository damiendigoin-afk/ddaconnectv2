import { describe, expect, it } from "vitest";

import { brandFilterUrl, extractBrandFilters } from "../tire-provider.server";

/**
 * La page générique d'une dimension ne montre que les premiers produits :
 * les marques des gammes paramétrées doivent être retrouvées via leur filtre.
 */
const HTML = `
<div class="filters">
  <input type="checkbox" id="brands_4" name="brands[]" value="4" />
  <label for="brands_4">Michelin</label>
  <input type="checkbox" id="brands_225" name="brands[]" value="225" />
  <label for="brands_225">Sailun</label>
  <input type="checkbox" id="brands_12" name="brands[]" value="12" />
  <label for="brands_12">Kleber</label>
</div>`;

describe("filtres de marque CentralePneus", () => {
  it("extrait les identifiants fournisseur des marques", () => {
    const map = extractBrandFilters(HTML);
    expect(map.get("michelin")).toBe("4");
    expect(map.get("sailun")).toBe("225");
    expect(map.get("kleber")).toBe("12");
  });

  it("ne renvoie rien pour une marque absente du fournisseur", () => {
    expect(extractBrandFilters(HTML).get("marque-inconnue")).toBeUndefined();
  });

  it("construit l'URL filtrée par marque", () => {
    expect(brandFilterUrl("https://www.centralepneus.fr/pneu-auto-205-55-16/", "4")).toBe(
      "https://www.centralepneus.fr/pneu-auto-205-55-16/?brands%5B%5D=4",
    );
  });
});
