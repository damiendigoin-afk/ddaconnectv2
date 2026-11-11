import { describe, expect, it } from "vitest";
import { inventoryEuroAmounts } from "../ixellio-parts-amounts";

const HTML = `<html><body><table><tr><td>
<table><tr><td>Référence : 214992066R</td><td>RENAULT</td></tr></table>
<table><tr><td>GUIDAGE AIR ARMATURE AV</td><td>26.44 €</td></tr>
<tr><td>CONVERGENT G</td><td>26.44 €</td></tr></table>
<table><tr><td>Référence : 214992066R</td><td>12,50 € TOKEN9ABC</td></tr></table>
</td></tr></table>
<script>var p = "99,99 €"; createPrixStatusTool('S', 1);</script><!-- 77,77 € --><style>.x{}</style></body></html>`;

describe("inventaire des montants € IXELLIO", () => {
  const inv = inventoryEuroAmounts(HTML, "214992066R");

  it("compte les montants visibles sans libellé « prix », hors scripts/commentaires", () => {
    expect(inv.total).toBe(3);
    expect(inv.distinctAmounts).toBe(2);
    expect(inv.items.map((i) => i.amount)).toEqual([26.44, 26.44, 12.5]);
  });

  it("donne la ligne et la position, association non vérifiée hors tableau Référence", () => {
    expect(inv.items[0]).toMatchObject({ rowLabel: "GUIDAGE AIR ARMATURE AV", tableDepth: 2, cellIndex: 1, referenceLevelsUp: null, association: "non vérifiée" });
    expect(inv.items[1]!.rowLabel).toBe("CONVERGENT G");
  });

  it("rattache seulement dans le même tableau que « Référence : » et masque réf/jetons", () => {
    expect(inv.items[2]).toMatchObject({ referenceLevelsUp: 0, association: "même tableau que Référence" });
    const json = JSON.stringify(inv);
    expect(json).not.toMatch(/214992066R|TOKEN9ABC|createPrixStatusTool|99,99|77,77/);
    expect(inv.items[2]!.rowLabel).toBe("Référence : [réf]");
  });
});

import { partsOutcome } from "../ixellio-parts.server";
import { parseIxellioParts } from "../ixellio-parts-parse";

describe("candidats catalogue Clio IV (synthétique)", () => {
  const CLIO = `<table><tr><td>
  <table><tr><td><table><tr><td>Référence : 214996296R</td><td>CLIO IV</td></tr></table></td></tr></table>
  <table><tr><td><table><tr><td><table><tr><td>GUIDAGE AIR ARMATURE AV</td><td>26.44 €</td></tr></table></td></tr></table></td></tr></table>
  <table><tr><td><table><tr><td>Référence : 214996296R</td><td>RENAULT</td></tr></table></td></tr></table>
  <table><tr><td><table><tr><td><table><tr><td>CONVERGENT G</td><td>26.44 €</td></tr></table></td></tr></table></td></tr></table>
  </td></tr></table>`;
  const inv = inventoryEuroAmounts(CLIO, "214996296R");

  it("liste deux lignes candidates, un seul montant distinct, bases inconnues, jamais validées", () => {
    expect(inv.candidates.map((c) => [c.label, c.amount])).toEqual([["GUIDAGE AIR ARMATURE AV", 26.44], ["CONVERGENT G", 26.44]]);
    expect(inv.distinctAmounts).toBe(1);
    for (const c of inv.candidates) {
      expect(c).toMatchObject({ association: "non vérifiée", basis: "inconnu", isPublic: "inconnu", isPurchase: "inconnu" });
    }
    expect(JSON.stringify(inv)).not.toContain("214996296R");
  });

  it("l'ancêtre commun englobe plusieurs candidats et ancres : aucune correspondance déduite", () => {
    for (const c of inv.candidates) {
      expect(c.commonAncestor).toMatchObject({ candidatesInside: 2, referenceAnchorsInside: 2 });
    }
  });

  it("le statut reste non validé : aucune pièce, structure_non_reconnue", () => {
    const parsed = parseIxellioParts(CLIO, "214996296R");
    expect(parsed.parts).toHaveLength(0);
    expect(partsOutcome(parsed.parts.length, parsed.noResult)[0]).toBe("structure_non_reconnue");
  });

  it("une même ligne répétée est regroupée, pas comptée comme deux tarifs", () => {
    const dup = inventoryEuroAmounts(`<table><tr><td>CONVERGENT G</td><td>26.44 €</td></tr><tr><td>CONVERGENT G</td><td>26.44 €</td></tr></table>`, "X1234");
    expect(dup.candidates).toEqual([expect.objectContaining({ label: "CONVERGENT G", occurrences: 2 })]);
  });
});
