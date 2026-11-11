import { describe, expect, it } from "vitest";
import { analyzeJsFlow, matchBrace } from "../ixellio-js-flow";
import { analyzeScriptFile } from "../ixellio-scripts.server";

const JS = `
// commentaire { non fermé
function selectPiece(row, pieceId) {
  $(row).addClass("selected"); var s = "}"; /* } */
  if (pieceId) { initInterventions(pieceId, 'TOKEN_ABC_123'); }
}
function initInterventions(id, tok) {
  var html = '<input type="checkbox" name="interv_445566"> Remplacer';
  $.ajax({ url: '/ajax/Intervention.html?method=listInterventions&pid=' + id + '&csrf=SECRET9', type: 'GET' });
  createPopupToDisplayContent(html);
}
createPopupToDisplayContent = function(content) {
  $("#popin_998877").dialog({ buttons: { OK: function(){ saveSelectionToChiffrage(); }, Annuler: function(){} } });
};
function saveSelectionToChiffrage() {
  $.post('/ChiffragePiece.html?method=addElement&ref=214992066R&tel=0612345678');
}
`;

describe("analyse statique chaîne sélection → popup", () => {
  const f = analyzeJsFlow(JS);
  const fn = (n: string) => f.functions.find((x) => x.name === n)!;
  const json = JSON.stringify(f);

  it("fonctions, paramètres et appels, accolades dans chaînes/commentaires ignorées", () => {
    expect(fn("selectPiece")).toMatchObject({ exists: true, parse: "ok", params: ["row", "pieceId"] });
    expect(fn("selectPiece").calls).toContain("initInterventions");
    expect(fn("initInterventions").ajax).toEqual([{ fn: "$.ajax", method: "GET" }]);
    expect(fn("initInterventions").endpoints).toEqual([{ path: "/ajax/Intervention.html", method: "listInterventions" }]);
    expect(fn("initInterventions")).toMatchObject({ buildsCheckboxes: true, interventionList: true, minuteUnitExplicit: false });
    expect(fn("createPopupToDisplayContent").outcomes).toContain("popup");
    expect(fn("createPopupToDisplayContent").domShapes).toEqual(["popin_#"]);
    expect(fn("selectElement")).toMatchObject({ exists: false, parse: "absente" });
  });

  it("OK → save probable et écriture chiffrage signalée", () => {
    expect(f.okCallsSave).toBe("probable");
    expect(f.saveIsMutating).toBe("probable");
    expect(fn("saveSelectionToChiffrage").ajax).toEqual([{ fn: "$.post", method: "POST" }]);
    expect(fn("saveSelectionToChiffrage").outcomes).toContain("écriture chiffrage probable");
    expect(f.warnings.join(" ")).toMatch(/ne jamais l'appeler/);
  });

  it("aucune fuite de valeurs, jetons, code ni durée", () => {
    for (const leak of ["TOKEN_ABC", "SECRET9", "445566", "998877", "214992066R", "0612345678", "<input", "$(row)"]) expect(json).not.toContain(leak);
    expect(json).not.toMatch(/"durationMinutes"|minutes":\s*\d/);
  });

  it("corps non analysable signalé", () => {
    const g = analyzeJsFlow("function selectPiece(a) { if (a) { x('unterminated); }");
    expect(g.functions[0]).toMatchObject({ exists: true, parse: "non analysable" });
    expect(matchBrace("{ '}' }", 0)).toBe(6);
  });

  it("fichier externe : JS seulement, HTML refusé, temps visible seulement si min + réseau", () => {
    expect(analyzeScriptFile("/scripts/x.js", 200, "text/html", "<html>").outcome).toBe("type non JS");
    expect(analyzeScriptFile("/scripts/x.js", 302, null, "").outcome).toBe("redirection non suivie");
    const r = analyzeScriptFile("/scripts/intervention.js", 200, "application/javascript", JS);
    expect(r.outcome).toBe("analysé");
    expect(r.timeSourceVisible).toBe(false);
    const t = analyzeScriptFile("/scripts/i.js", 200, "text/javascript", "function initInterventions(){ $.get('/ajax/Temps.html?method=get'); var u=' min'; }");
    expect(t.timeSourceVisible).toBe(true);
    expect(JSON.stringify(r)).not.toContain("SECRET9");
  });
});
