// Fixtures SYNTHÉTIQUES reproduisant le contenu lisible fourni (pas le HTML réel IXELLIO).
import { describe, expect, it } from "vitest";
import { groupIxellioResults } from "../ixellio-parts-results";

const result = (cat: string, des: string, ref: string, extra = "") =>
  `<tr><td><table><tr><td>${cat}</td></tr></table>
   <table><tr><td>${des}</td><td>26.44 €</td></tr></table>
   <table><tr><td>Référence : ${ref}</td>${extra}</tr></table></td></tr>`;
const page = (body: string, n: number) => `<html><body><table><tr><td>Atelier > Recherche de pièces pour la référence 214996296R</td></tr></table>
<div>Sélectionnez votre pièce parmi les ${n} résultat(s) exact(s)</div><table>${body}</table>
<script>var x="99,99 €";</script></body></html>`;

describe("groupement des résultats exacts IXELLIO", () => {
  it("deux résultats frères, même référence et même prix : deux entrées, rien de dédupliqué", () => {
    const g = groupIxellioResults(page(
      result("ARMATURE AV", "GUIDAGE AIR ARMATURE AV", "214996296R") +
      result("RÉFÉRENCE(S) MÉTIER(S)", "CONVERGENT G", "214996296R", "<td>Famille : Mécanique Carrosserie</td>"), 2));
    expect(g.announced).toBe(2);
    expect(g.confidence).toBe("haute");
    expect(g.results).toHaveLength(2);
    expect(g.results[0]).toMatchObject({ category: "ARMATURE AV", designation: "GUIDAGE AIR ARMATURE AV", reference: "214996296R", amount: 26.44, basis: "HT", tariffCategory: "public_constructeur", isPublic: true, isPurchase: false, source: "IXELLIO" });
    expect(g.results[1]).toMatchObject({ amount: 26.44, priceDisplayed: "26.44 €" });
    expect(g.results[0]!.qualificationSource).toMatch(/déclaration du gérant.*prix public constructeur HT/);
    expect(g.results[1]).toMatchObject({ category: "RÉFÉRENCE(S) MÉTIER(S)", designation: "CONVERGENT G", family: "Mécanique Carrosserie" });
    expect(g.quoteConversion).toBe("bloquée");
    expect(JSON.stringify(g)).not.toMatch(/99,99/);
  });

  it("deux références différentes ne sont jamais croisées", () => {
    const g = groupIxellioResults(page(result("A", "PIECE UN", "111111111A") + result("B", "PIECE DEUX", "222222222B"), 2));
    expect(g.results.map((r) => [r.designation, r.reference])).toEqual([["PIECE UN", "111111111A"], ["PIECE DEUX", "222222222B"]]);
  });

  it("cas ambigu (prix et références dans des blocs séparés) : refusé, candidats non validés", () => {
    const g = groupIxellioResults(page(`<tr><td><table><tr><td>PIECE UN</td><td>26.44 €</td></tr><tr><td>PIECE DEUX</td><td>26.44 €</td></tr></table>
      <table><tr><td>Référence : 214996296R</td></tr></table><table><tr><td>Référence : 214996296R</td></tr></table></td></tr>`, 2));
    expect(g.results).toHaveLength(0);
    expect(g.confidence).toBe("refusée");
    expect(g.ungrouped).toHaveLength(2);
  });

  it("nombre groupé différent du nombre annoncé : confiance partielle", () => {
    const g = groupIxellioResults(page(result("A", "PIECE UN", "214996296R"), 2));
    expect(g.confidence).toBe("partielle");
  });

  it("prix public constructeur : jamais prix d'achat, conversion devis bloquée sans motif HT/TTC", () => {
    const g = groupIxellioResults(page(result("A", "PIECE UN", "214996296R"), 1));
    for (const r of g.results) {
      expect(r.isPurchase).toBe(false);
      expect(Object.keys(r)).not.toEqual(expect.arrayContaining(["purchasePrice"]));
      expect(Object.keys(r).some((k) => /purchase_?price|unitCost|pa_?ht/i.test(k))).toBe(false);
    }
    expect(g.quoteConversion).toBe("bloquée");
    expect(g.quoteConversionReason).toMatch(/groupement/i);
    expect(g.quoteConversionReason).toMatch(/prix d'achat/);
    expect(g.quoteConversionReason).not.toMatch(/HT\/TTC|inconnu/);
  });
});
