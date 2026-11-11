// Fixtures SYNTHÉTIQUES (pas le HTML réel IXELLIO).
import { describe, expect, it } from "vitest";
import { inspectIxellioMenu, laborAccessStatus, parseLaborTimes, sanitizeInternalUrl } from "../ixellio-labor-parse";
import { acquireIxellio, releaseIxellio, __resetIxellioLock } from "../ixellio-lock.server";

const MENU = `<html><head><title>Ixellio Menu</title><script>var u="/TempsBareme.html?method=index&_csrf=SCRIPTTOK";</script></head><body>
<table><tr><td><table><tr><td><a href="/PieceRecherche.html">Recherche de pièces</a></td>
<td><a href="/ChiffragePiece.html?method=init&idChiffrage=987654&jsessionid=ABC">Chiffrage</a></td></tr></table></td></tr></table>
<a href="/ident.html?method=searchByImmat&immat=AB123CD">Identification véhicule</a>
<a href="/TempsMO.html?method=list&vin=VF1RHN00772214934&codeOperation=X1">Temps barèmes constructeur</a>
<a href="https://evil.example/x.html">Externe</a><a href="javascript:void(0)">JS</a><a href="/logout.html">Déconnexion</a>
<form action="/ident.html?method=searchByImmat" method="post"><input type="hidden" name="_csrf" value="CSRFVAL"/>
<input name="immat" value="GY640HM"/><select name="marque"><option>R</option></select></form>
<div>Contact : jean@x.fr</div></body></html>`;

describe("IXELLIO temps barémés — inspection du menu", () => {
  it("liste les liens internes classés, sans secrets ni valeurs", () => {
    const m = inspectIxellioMenu(MENU);
    const paths = m.entries.map((e) => `${e.httpMethod} ${e.path}`);
    expect(paths).toEqual(expect.arrayContaining(["GET /PieceRecherche.html", "GET /ChiffragePiece.html?method=init", "GET /TempsMO.html?method=list", "GET /TempsBareme.html?method=index", "POST /ident.html?method=searchByImmat"]));
    expect(paths.some((p) => /evil|logout|javascript/.test(p))).toBe(false);
    const tm = m.entries.find((e) => e.path.startsWith("/TempsMO"))!;
    expect(tm).toMatchObject({ category: "temps_bareme", needsVehicle: true, needsOperation: true, paramNames: ["vin", "codeOperation"] });
    expect(m.entries.find((e) => e.path.startsWith("/ChiffragePiece"))!.category).toBe("chiffrage");
    expect(m.forms[0]).toEqual({ path: "/ident.html?method=searchByImmat", httpMethod: "POST", fields: [{ name: "immat", type: "text" }, { name: "marque", type: "select" }] });
    const json = JSON.stringify(m);
    for (const s of ["CSRFVAL", "SCRIPTTOK", "_csrf", "jsessionid", "ABC", "987654", "VF1RHN", "AB123CD", "GY640HM", "jean@", "<"]) expect(json).not.toContain(s);
    expect(laborAccessStatus(m)).toEqual({ code: "menu_identifie_tm_non_recuperes", laborStatus: "structure_unknown" });
    expect(m.laborCandidates).toBe(0);
  });

  it("menu sans lien TM : aucun_lien_tm ; menu vide : menu_vide ; page de connexion détectée", () => {
    expect(laborAccessStatus(inspectIxellioMenu(`<a href="/PieceRecherche.html">Pièces</a>`)).code).toBe("aucun_lien_tm");
    expect(laborAccessStatus(inspectIxellioMenu(`<p>Bienvenue</p>`)).code).toBe("menu_vide");
    expect(laborAccessStatus(inspectIxellioMenu(`<form action="/j_spring_security_check"><input name="j_username"><input type="password" name="j_password"></form>`)).code).toBe("page_connexion");
    expect(laborAccessStatus(inspectIxellioMenu(`<a href="/TempsMO.html">Temps barèmes</a><p>Module non souscrit</p>`)).code).toBe("acces_limite");
  });

  it("Redressage/Réparation | Temps : chiffrage carrosserie, jamais TM", () => {
    const m = inspectIxellioMenu(`<a href="/ChiffragePiece.html?method=temps">Redressage temps</a>`);
    expect(m.entries[0]!.category).toBe("chiffrage");
    expect(parseLaborTimes(`<table><tr><td>Redressage</td><td>Temps</td></tr><tr><td>AU SOL SUR MARBRE</td><td>1,5</td></tr></table>`).times).toEqual([]);
  });

  it("sanitizeInternalUrl : noms de paramètres seulement, secrets retirés", () => {
    expect(sanitizeInternalUrl("/X.html?method=go&token=abc&idVehicule=12")).toEqual({ path: "/X.html?method=go", paramNames: ["idVehicule"] });
    expect(sanitizeInternalUrl("mailto:a@b.fr")).toBeNull();
  });
});

describe("IXELLIO temps barémés — aucune durée inventée", () => {
  it("pas de tableau explicite : aucun TM", () => {
    expect(parseLaborTimes(MENU)).toEqual({ times: [], status: "no_result" });
    expect(parseLaborTimes(`<p>Vidange 0,8</p>`).times).toEqual([]);
  });
  it("colonne temps sans unité déclarée (ex. UT) : structure_unknown, aucune durée", () => {
    expect(parseLaborTimes(`<table><tr><th>Opération</th><th>Temps</th></tr><tr><td>Vidange</td><td>8</td></tr></table>`)).toEqual({ times: [], status: "structure_unknown" });
  });
  it("tableau explicite : heures exactes, minutes converties, niveau T présent", () => {
    const h = parseLaborTimes(`<table><tr><th>Code</th><th>Opération</th><th>Temps (h)</th><th>Niveau</th></tr>
      <tr><td>A10</td><td>Vidange moteur</td><td>0,8</td><td>T1</td></tr><tr><td>A11</td><td>Redressage aile</td><td>2</td><td>T2</td></tr></table>`);
    expect(h.times).toEqual([expect.objectContaining({ operationCode: "A10", operationLabel: "Vidange moteur", durationHours: 0.8, timeUnitOriginal: "h", labourGrade: "T1", vehicleMatch: null })]);
    const m = parseLaborTimes(`<table><tr><th>Opération</th><th>Durée (min)</th></tr><tr><td>Filtre habitacle</td><td>15</td></tr></table>`);
    expect(m.times[0]).toMatchObject({ durationHours: 0.25, timeUnitOriginal: "min", labourGrade: null, operationCode: null });
  });
});

describe("verrou IXELLIO partagé", () => {
  it("une seule consultation à la fois, 15 s entre deux", () => {
    __resetIxellioLock();
    expect(acquireIxellio(100_000)).toEqual({ ok: true });
    expect(acquireIxellio(100_001)).toEqual({ ok: false, reason: "busy" });
    releaseIxellio();
    expect(acquireIxellio(110_000)).toEqual({ ok: false, reason: "rate_limited" });
    expect(acquireIxellio(115_000)).toEqual({ ok: true });
    releaseIxellio();
  });
});
