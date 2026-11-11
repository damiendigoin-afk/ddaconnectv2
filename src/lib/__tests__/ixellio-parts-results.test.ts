// Fixtures SYNTHÉTIQUES reproduisant le contenu lisible fourni (pas le HTML réel IXELLIO).
import { describe, expect, it } from "vitest";
import { groupIxellioResults, groupingToParts } from "../ixellio-parts-results";

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

  // Bruit atelier (multi-cases) AVANT la vraie catégorie, puis prix, puis Référence.
  const noisy = (cat: string, des: string, ref: string, noiseAfterCat = false) =>
    `<tr><td><table><tr><td>Redressage</td><td>Temps</td><td></td><td>AU SOL SUR MARBRE</td></tr></table>
     <table><tr><td>Réparation</td><td>Temps</td></tr></table><table><tr><td>Peinture</td><td>Type</td></tr></table>
     <table><tr><td>${cat}</td></tr></table>
     ${noiseAfterCat ? '<table><tr><td>Redressage</td><td>AU SOL SUR MARBRE</td></tr></table>' : ""}
     <table><tr><td>${des}</td><td>26.44 €</td></tr></table>
     <table><tr><td>Référence : ${ref}</td></tr></table></td></tr>`;

  it("bruit Redressage/Réparation/Peinture : jamais pris comme catégorie, vraie catégorie retenue", () => {
    const g = groupIxellioResults(page(noisy("ARMATURE AV", "GUIDAGE AIR ARMATURE AV", "214996296R") + noisy("RÉFÉRENCE(S) MÉTIER(S)", "CONVERGENT G", "214996296R"), 2));
    expect(g.results.map((r) => [r.category, r.categoryConfidence, r.designation])).toEqual([
      ["ARMATURE AV", "vérifiée", "GUIDAGE AIR ARMATURE AV"], ["RÉFÉRENCE(S) MÉTIER(S)", "vérifiée", "CONVERGENT G"]]);
    expect(JSON.stringify(g.results)).not.toMatch(/Redressage|MARBRE/);
    expect(g.confidence).toBe("haute");
  });

  it("catégorie ambiguë (bruit juste avant le prix) : null, non vérifiée, confiance globale non haute", () => {
    const g = groupIxellioResults(page(noisy("ARMATURE AV", "GUIDAGE AIR", "214996296R", true) + noisy("X", "CONVERGENT G", "214996296R"), 2));
    expect(g.results).toHaveLength(2);
    expect(g.results[0]).toMatchObject({ category: null, categoryConfidence: "non vérifiée" });
    expect(g.groupingConfidence).toBe("haute");
    expect(g.confidence).toBe("partielle");
    expect(JSON.stringify(g.results)).not.toMatch(/Redressage/);
  });

  it("deux références différentes avec bruit : pas de croisement, pas de dédup", () => {
    const g = groupIxellioResults(page(noisy("A", "P1", "111111111A") + noisy("A", "P1", "222222222B"), 2));
    expect(g.results.map((r) => r.reference)).toEqual(["111111111A", "222222222B"]);
  });

  // Table montant NON feuille (icône imbriquée dans une autre ligne) + catégorie contenant un faux tableau vide.
  const nested = (cat: string, des: string, ref: string) =>
    `<tr><td><table><tr><td>${cat}<table><tr><td></td></tr></table></td></tr></table>
     <table><tr><td>${des}</td><td>26.44 €</td></tr><tr><td colspan="2"><table><tr><td><img alt=""></td></tr></table></td></tr></table>
     <table><tr><td>Redressage</td><td>Temps</td><td>AU SOL SUR MARBRE</td></tr></table>
     <table><tr><td>Référence : ${ref}</td></tr></table></td></tr>`;

  it("v5 : table montant non feuille et faux tableaux internes, catégories retrouvées, diagnostic G", () => {
    const g = groupIxellioResults(page(nested("ARMATURE AV", "GUIDAGE AIR ARMATURE AV", "214996296R") + nested("RÉFÉRENCE(S) MÉTIER(S)", "CONVERGENT G", "214996296R"), 2), "214996296R");
    expect(g.results.map((r) => r.category)).toEqual(["ARMATURE AV", "RÉFÉRENCE(S) MÉTIER(S)"]);
    expect(g.categoriesVerified).toBe(2);
    expect(JSON.stringify(g.results)).not.toMatch(/Redressage|MARBRE/);
    expect(g.categoryProbes).toHaveLength(2);
    expect(g.categoryProbes[0]!.probes.some((p) => p.verdict === "retenue")).toBe(true);
    expect(JSON.stringify(g.categoryProbes)).not.toMatch(/<|214996296R/);
  });

  it("v5 : deux en-têtes mono-cellule ambigus séparés par du bruit -> on ne traverse pas, null", () => {
    const g = groupIxellioResults(page(noisy("ARMATURE AV", "P1", "214996296R", true), 1), "214996296R");
    expect(g.results[0]!.category).toBeNull();
    expect(g.categoryProbes[0]!.probes[0]!.verdict).toMatch(/pas mono-cellule/);
  });

  it("statut : parts issues du groupement seulement si complet et réf = cherchée; catégorie absente tolérée", () => {
    const html = page(noisy("ARMATURE AV", "GUIDAGE AIR", "214996296R", true) + noisy("X", "CONVERGENT G", "214996296R"), 2);
    const parts = groupingToParts(groupIxellioResults(html, "214996296R"), "214996296R")!;
    expect(parts).toHaveLength(2);
    expect(parts[0]!.prices[0]).toMatchObject({ amount: 26.44, basis: "HT", isPublic: true });
    expect(parts[0]!.extra["Catégorie"]).toBe("non vérifiée");
    expect(groupingToParts(groupIxellioResults(html, "214996296R"), "999999999Z")).toBeNull();
    const mixed = page(noisy("A", "P1", "214996296R") + noisy("B", "P2", "222222222B"), 2);
    expect(groupingToParts(groupIxellioResults(mixed, "214996296R"), "214996296R")).toBeNull();
    expect(groupingToParts(groupIxellioResults(page(noisy("A", "P1", "214996296R"), 2)), "214996296R")).toBeNull();
  });
});
