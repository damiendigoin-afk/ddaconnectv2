import { describe, expect, it } from "vitest";
import { inspectReplaceControls, safeEndpoints } from "../ixellio-parts-replace";
import { inventoryEuroAmounts } from "../ixellio-parts-amounts";

const HTML = `<form action="/CGU.html"><input type="checkbox" name="accept"></form>
<table><tr><td><table><tr><td>ARMATURE AV</td></tr></table>
<table><tr><td>GUIDAGE AIR ARMATURE AV</td><td>26.44 €</td><td><input type="checkbox" id="rempl_998877" name="remplacer_998877" data-piece-123456="x" onclick="majTemps(this, '998877'); $.post('/ajax/ChiffragePiece.html?method=calculTemps&token=SECRETTOKEN')"><label for="rempl_998877">Remplacer</label></td></tr></table>
<table><tr><td>Redressage</td><td>Temps</td><td>AU SOL SUR MARBRE</td></tr><tr><td>Réparation</td><td>Temps</td><td></td></tr><tr><td>Peinture</td><td>12</td></tr></table>
<table><tr><td>Référence : 214992066R</td></tr></table>
<table><tr><td>CONVERGENT G</td><td>26.44 €</td><td><input type="checkbox" checked name="remplacer_554433"> Remplacer</td></tr></table>
<table><tr><td>Temps</td><td>30 min</td></tr></table>
<table><tr><td>Référence : 214992066R</td></tr></table></td></tr></table>
<script>function calculTempsRemplacement(id){ $.ajax({url:'/ajax/ChiffragePiece.html?method=getTemps&pid='+id+'&_csrf=ABCDEF123456'}); var tel='0612345678'; }</script>`;

describe("diagnostic v7 option Remplacer", () => {
  const d = inspectReplaceControls(HTML, "214992066R");
  const json = JSON.stringify(d);

  it("trouve les cases Remplacer par carte, ignore les autres cases", () => {
    expect(d.controls).toHaveLength(2);
    expect(d.otherCheckboxes).toBe(1);
    expect(d.controls[0]).toMatchObject({ designation: "GUIDAGE AIR ARMATURE AV", designationSource: "même ligne", type: "checkbox", label: "Remplacer", checkedDefault: false, nameShape: "remplacer_#", form: null });
    expect(d.controls[1]).toMatchObject({ designation: "CONVERGENT G", checkedDefault: true });
  });

  it("gestionnaire : noms de fonctions et chemin + method seulement", () => {
    const h = d.controls[0]!.handlers[0]!;
    expect(h.event).toBe("onclick");
    expect(h.functions).toContain("majTemps");
    expect(h.endpoints).toEqual([{ path: "/ajax/ChiffragePiece.html", method: "calculTemps" }]);
    expect(d.scripts.functions).toContain("calculTempsRemplacement");
    expect(d.scripts.endpoints).toEqual([{ path: "/ajax/ChiffragePiece.html", method: "getTemps" }]);
  });

  it("ne divulgue ni identifiants, jetons, valeurs, script ni référence", () => {
    expect(json).not.toMatch(/998877|554433|123456|SECRETTOKEN|ABCDEF|0612345678|214992066R|\$\.ajax|pid=/);
  });

  it("lignes de temps : format et unité sans inventer de durée", () => {
    const units = d.timeRows.map((t) => `${t.label}:${t.unit}`);
    expect(units).toEqual(["Redressage:aucune unité affichée", "Réparation:aucune unité affichée", "Peinture:aucune unité affichée", "Temps:minutes"]);
    expect(json).not.toMatch(/"30|duration|minutesValue/);
    expect(d.warnings.join(" ")).toMatch(/pas assimilé à un TM constructeur/);
  });

  it("prix intacts (deux lignes, un montant distinct)", () => {
    const inv = inventoryEuroAmounts(HTML, "214992066R");
    expect(inv.items.map((i) => i.amount)).toEqual([26.44, 26.44]);
    expect(inv.distinctAmounts).toBe(1);
  });

  it("sans contrôle : avertissement sélection préalable", () => {
    const e = inspectReplaceControls("<table><tr><td>X</td><td>1,00 €</td></tr></table>");
    expect(e.controls).toHaveLength(0);
    expect(e.warnings[0]).toMatch(/après sélection/);
  });

  it("refuse les hôtes externes", () => {
    expect(safeEndpoints("fetch('https://evil.com/Steal.html?method=x')")).toEqual([]);
  });
});
