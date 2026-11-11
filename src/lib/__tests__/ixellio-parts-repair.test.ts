import { describe, expect, it } from "vitest";
import { inspectRepairRows, safeOptionLabel } from "../ixellio-parts-repair";
import { groupIxellioResults } from "../ixellio-parts-results";

const card = (cat: string, des: string, sel: string) => `<table><tr><td>
<table><tr><td>${cat}</td><td></td><td><img src="x.gif"></td></tr></table>
<table><tr><td>${des}</td><td>26.44 €</td></tr></table>
<table><tr><td>Redressage</td><td>Temps</td><td><input type="text" name="redr_123456" value="45"></td><td><select name="redrType"><option>AU SOL SUR MARBRE</option></select></td></tr>
<tr><td>Réparation</td><td>Temps</td><td><input type="text" name="rep_998877" value="30" title="Temps réparation" onchange="majChiffrage(this,'998877');$.post('/ajax/ChiffragePiece.html?method=updateElement&token=SECRET42')"></td><td><select name="repNiv_998877" class="sel-niveau"><option value="ID9911">T1</option><option value="ID9912" selected>T2</option><option value="ID9913">T3</option><option value="X">Client AB-123-CD</option></select></td></tr>
<tr><td>Peinture</td><td><select name="peint"><option>Opaque</option></select></td></tr></table>
<table><tr><td>Référence : 214992066R</td></tr></table>
</td></tr></table>`;
const HTML = `<p>Sélectionnez votre pièce parmi les 2 résultat(s) exact(s)</p>
<table><tr><td>${card("ARMATURE AV", "GUIDAGE AIR", "T2")}</td></tr><tr><td>${card("RÉFÉRENCE(S) MÉTIER(S)", "CONVERGENT G", "T1")}</td></tr></table>
<script>function remplacerPiece(){ $.ajax('/ChiffragePiece.html?method=remove&id=55') }</script>`;

describe("diagnostic v8 lignes Réparation", () => {
  const g = groupIxellioResults(HTML, "214992066R");
  const d = inspectRepairRows(HTML, "214992066R", g.results, g.groupingConfidence === "haute");
  const json = JSON.stringify(d);

  it("rattache chaque ligne Réparation à son résultat par bloc exclusif", () => {
    expect(d.rows).toHaveLength(2);
    expect(d.rows[0]!.mapping).toMatchObject({ status: "vérifiée", designation: "GUIDAGE AIR" });
    expect(d.rows[1]!.mapping).toMatchObject({ status: "vérifiée", designation: "CONVERGENT G" });
  });

  it("champs : forme du nom, type, options masquées, jamais de valeur", () => {
    const r = d.rows[0]!;
    expect(r.cells).toBe(4);
    expect(r.unit).toBe("aucune unité affichée");
    const [inp, sel] = r.controls;
    expect(inp).toMatchObject({ tag: "input", type: "text", nameShape: "rep_#", hintCategory: "temps", valuePresent: true, valueNumeric: true });
    expect(inp!.handlers[0]!.functions).toContain("majChiffrage");
    expect(inp!.handlers[0]!.endpoints).toEqual([{ path: "/ajax/ChiffragePiece.html", method: "updateElement" }]);
    expect(sel!.options).toMatchObject({ count: 4, selectedLabel: "T2" });
    expect(sel!.options!.labels.slice(0, 3)).toEqual(["T1", "T2", "T3"]);
    expect(r.optionFlags).toMatchObject({ t1t2t3: true, remplacer: false });
    expect(r.customCheckbox.classHints).toContain("sel-niveau");
    for (const leak of ["ID991", "998877", "SECRET42", "AB-123-CD", "214992066R", '"30"', '"45"', "value\":"]) expect(json).not.toContain(leak);
  });

  it("hors lignes : pas de remplac visible, script non exposé, aucune durée affirmée", () => {
    expect(d.outside.remplacTextOccurrences).toBe(0);
    expect(json).not.toContain("remplacerPiece");
    expect(d.warnings.join(" ")).toMatch(/aucune durée/i);
  });

  it("sans groupement validé : non vérifiée, jamais par l'ordre", () => {
    const u = inspectRepairRows(HTML, "214992066R", g.results, false);
    expect(u.rows.every((r) => r.mapping.status === "non vérifiée" && r.mapping.resultIndex === null)).toBe(true);
  });

  it("bloc ambigu (deux lignes Réparation pour un prix) refusé", () => {
    const amb = `<table><tr><td><table><tr><td>X</td><td>26.44 €</td></tr></table><table><tr><td>Réparation</td><td>a</td></tr><tr><td>Réparation</td><td>b</td></tr></table><table><tr><td>Référence : 1234X</td></tr></table></td></tr></table>`;
    const r = inspectRepairRows(amb, "", [{ index: 1, category: null, designation: "X", amount: 26.44 }], true);
    expect(r.rows.every((x) => x.mapping.status === "non vérifiée")).toBe(true);
  });

  it("libellé d'option : VIN, plaque, nombres masqués sauf T1/T2/T3", () => {
    expect(safeOptionLabel("VF1RHN00774040932")).toBe("[vin]");
    expect(safeOptionLabel("Remplacer 30 min")).toBe("Remplacer # min");
    expect(safeOptionLabel("T3")).toBe("T3");
  });
});

import { inspectReplaceControls } from "../ixellio-parts-replace";

describe("v8.1 faux positif T1/T2/T3", () => {
  const row = (rep: string) => `<table><tr><td><table><tr><td>PIECE A</td><td>26.44 €</td></tr></table>
<table><tr><td>Réparation</td><td>Temps</td><td>${rep}</td><td><select id="s1"><option value="9">T1</option><option value="8">T2</option><option value="7">T3</option></select></td></tr></table>
<table><tr><td>Référence : 1234X</td></tr></table></td></tr></table>`;
  const G = [{ index: 1, category: null, designation: "PIECE A", amount: 26.44 }];

  it("options T1/T2/T3 + saisie vide : aucun nombre, aucune durée", () => {
    const html = row(`<input type="text" id="t1" value="" size="4" maxlength="5">`);
    const d = inspectRepairRows(html, "", G, true);
    const r = d.rows[0]!;
    expect(r.numericInText).toBe(false);
    expect(r.unit).toBe("aucune unité affichée");
    expect(r.controls[0]).toMatchObject({ valuePresent: false, valueNumeric: false });
    expect(r.optionFlags.t1t2t3).toBe(true);
    expect(d.warnings.join(" ")).not.toMatch(/Valeur numérique présente/);
    const h = inspectReplaceControls(html).timeRows.find((t) => t.label === "Réparation")!;
    expect(h.numericPresent).toBe(false);
  });

  it("libellé visible « 30 min » : nombre et unité détectés, valeur non exposée", () => {
    const d = inspectRepairRows(row("30 min"), "", G, true);
    expect(d.rows[0]).toMatchObject({ numericInText: true, unit: "minutes" });
    expect(JSON.stringify(d)).not.toContain("30");
    expect(inspectReplaceControls(row("30 min")).timeRows[0]).toMatchObject({ numericPresent: true, unit: "minutes" });
  });
});
