import { describe, expect, it } from "vitest";
import { inspectForms, inspectStructure, safeActionPath, safeLabel } from "../ixellio-parts-parse";
import { partsOutcome } from "../ixellio-parts.server";

const PAGE = `<form action="/PieceRecherche.html?method=searchRef&token=SECRET1" method="post">
<input type="hidden" name="_csrf" value="CSRFVALUE123"/><input type="hidden" name="method" value="searchReference"/>
<input type="text" name="refPiece" value="old"/><select name="marque"><option>A</option><option>B</option></select></form>`;

describe("diagnostic IXELLIO non sensible", () => {
  it("décrit les formulaires sans aucune valeur", () => {
    const f = inspectForms(PAGE);
    expect(f).toHaveLength(1);
    expect(f[0]!.action).toBe("/PieceRecherche.html?method=searchRef");
    expect(f[0]!.httpMethod).toBe("POST");
    expect(f[0]!.fields).toEqual([
      { name: "_csrf", type: "hidden" },
      { name: "method", type: "hidden" },
      { name: "refPiece", type: "text" },
      { name: "marque", type: "select", options: 2 },
    ]);
    const json = JSON.stringify(f);
    for (const secret of ["CSRFVALUE123", "SECRET1", "searchReference", "old"]) expect(json).not.toContain(secret);
  });

  it("refuse les hôtes tiers et nettoie les libellés", () => {
    expect(safeActionPath("https://evil.example/x.html")).toBe("[hôte externe]");
    const l = safeLabel("M. Dupont jean@x.fr 06 12 34 56 78 214992066R TOKEN9ABC", "214992066R");
    expect(l).not.toMatch(/jean@|06 12|214992066R|TOKEN9ABC/);
  });

  it("donne la structure des tableaux, imbrication et présence de la référence", () => {
    const html = `<html><head><title>Recherche</title><script>var u="/PieceAjax.json?ref=X&s=1";</script></head>
<body><div class="error">Champ obligatoire</div><table><tr><td><table><tr><th>Réf.</th><th>Prix HT</th></tr><tr><td>214 992 066R</td><td>12</td></tr></table></td></tr></table>
<div class="resultLine">a</div><div class="resultLine">b</div></body></html>`;
    const s = inspectStructure(html, "214992066R");
    expect(s.title).toBe("Recherche");
    expect(s.messages).toEqual(["Champ obligatoire"]);
    expect(s.tables.some((t) => t.nested && t.rows === 2 && t.headerRows[0]![0] === "Réf.")).toBe(true);
    expect(s.referencePresent).toBe(true);
    expect(s.repeatedBlocks).toEqual([{ cls: "resultLine", count: 2 }]);
    expect(s.scriptEndpoints).toContain("/PieceAjax.json");
    expect(JSON.stringify(s)).not.toContain("214 992 066R");
  });

  it("HTTP 200 sans ligne ni absence explicite n'est jamais ok", () => {
    expect(partsOutcome(0, false)[0]).toBe("structure_non_reconnue");
    expect(partsOutcome(0, true)[0]).toBe("no_result");
    expect(partsOutcome(2, false)[0]).toBe("ok");
  });
});
