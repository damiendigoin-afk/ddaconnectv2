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

import { vi, beforeEach } from "vitest";
vi.mock("../ixellio-store.server", () => ({ loadIxellioCredentials: vi.fn(async () => { throw new Error("identifiants lus"); }) }));
vi.mock("../ixellio.server", () => ({
  BROWSER_HEADERS: { "user-agent": "UA" }, cookieHeader: () => "", openIxellioSession: vi.fn(async () => { throw new Error("connexion tentée"); }),
}));
import { inspectIxellioPublicScripts } from "../ixellio-scripts.server";
import { __resetIxellioLock } from "../ixellio-lock.server";

const resp = (status: number, body: string, headers: Record<string, string> = {}) => new Response(status === 200 ? body : null, { status, headers });

describe("sonde publique sans connexion", () => {
  beforeEach(() => __resetIxellioLock());

  it("deux GET fixes, aucun cookie/authentification, pas de redirection suivie", async () => {
    const fetchImpl = vi.fn(async () => resp(200, JS, { "content-type": "application/javascript" }));
    const r = await inspectIxellioPublicScripts(fetchImpl as unknown as typeof fetch);
    expect(r.status).toBe("fichiers_publics_accessibles");
    expect(r.loginUsed).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const urls = fetchImpl.mock.calls.map((c) => (c as unknown as [string, RequestInit])[0]);
    expect(urls).toEqual(["https://www.ixellio.fr/scripts/pieceRecherche.js", "https://www.ixellio.fr/scripts/intervention.js"]);
    for (const c of fetchImpl.mock.calls) {
      const init = (c as unknown as [string, RequestInit])[1];
      expect(init.method).toBe("GET");
      expect(init.redirect).toBe("manual");
      const h = Object.keys(init.headers as Record<string, string>).map((k) => k.toLowerCase());
      expect(h).not.toContain("cookie");
      expect(h).not.toContain("authorization");
    }
    expect(JSON.stringify(r)).not.toContain("SECRET9");
  });

  it("302 vers connexion, 403 ou HTML => accès public refusé, rien d'autre tenté", async () => {
    const seq = [resp(302, "", { location: "/index.html" }), resp(403, "")];
    const f1 = vi.fn(async () => seq.shift()!);
    const r = await inspectIxellioPublicScripts(f1 as unknown as typeof fetch);
    expect(r.status).toBe("acces_public_refuse");
    expect(f1).toHaveBeenCalledTimes(2);
    expect(r.files.map((x) => x.outcome)).toEqual(["accès public refusé", "accès public refusé"]);
    __resetIxellioLock();
    const f2 = vi.fn(async () => resp(200, "<html>login</html>", { "content-type": "text/html" }));
    expect((await inspectIxellioPublicScripts(f2 as unknown as typeof fetch)).files[0]!.outcome).toBe("accès public refusé");
  });

  it("délai/erreur réseau : pas de relance", async () => {
    const f = vi.fn(async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); });
    const r = await inspectIxellioPublicScripts(f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.trace[0]).toMatch(/délai dépassé/);
  });
});
