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

import { categorize, inspectTempsPage } from "../ixellio-labor-parse";
import { classifyTempsResponse } from "../ixellio-labor-page.server";

describe("TM v2 — menu réel et page Temps (fixtures synthétiques)", () => {
  it("libellé exact « Temps » /Temps.html => temps_bareme ; Forfaits séparé ; carrosserie jamais TM", () => {
    const m = inspectIxellioMenu(`<a href="/Temps.html?method=search">Temps</a><a href="/Forfait.html?method=search">Forfaits</a>
      <a href="/GammeUniverselle.html?method=search">Gamme IXELL</a><a href="/PieceRecherche.html">Pièces</a>`);
    expect(m.entries.find((e) => e.path === "/Temps.html?method=search")!.category).toBe("temps_bareme");
    expect(m.entries.find((e) => e.path.startsWith("/Forfait"))!.category).toBe("forfaits");
    expect(laborAccessStatus(m).code).toBe("menu_identifie_tm_non_recuperes");
    expect(categorize("Redressage | Temps", "/ChiffragePiece.html")).toBe("chiffrage");
    expect(categorize("Réparation Temps", "/X.html")).toBe("chiffrage");
  });

  it("page avec formulaire GET : champs noms/types sans valeurs, besoin véhicule détecté, aucun TM", () => {
    const html = `<html><head><title>Ixellio Temps</title><script>document.location='/Temps.html?method=list&_csrf=TOK9';</script></head><body>
      <h2>Recherche de temps</h2><label>Immatriculation GY-640-HM</label>
      <form action="/Temps.html?method=searchVehicule" method="get"><input type="hidden" name="_csrf" value="CSRF1"/>
      <input name="immat" value="GY640HM"/><input name="vin" value="VF1RHN00072214934"/><select name="operation"><option>x</option></select><input type="submit" value="OK"/></form>
      <p>jean@x.fr</p></body></html>`;
    const p = inspectTempsPage(html);
    expect(p.forms[0]).toMatchObject({ path: "/Temps.html?method=searchVehicule", httpMethod: "GET" });
    expect(p.searchFields).toEqual([{ name: "immat", type: "text", hint: "vehicule" }, { name: "vin", type: "text", hint: "vehicule" }, { name: "operation", type: "select", hint: "operation" }]);
    expect(p).toMatchObject({ needsVehicle: true, needsOperation: true, explicitTimeRows: 0, times: [] });
    expect(p.links.some((l) => l.path === "/Temps.html?method=list")).toBe(true);
    const json = JSON.stringify(p);
    for (const s of ["CSRF1", "TOK9", "GY640HM", "GY-640-HM", "VF1RHN", "jean@", "<"]) expect(json).not.toContain(s);
  });

  it("page sans champ : rien inventé ; tableau explicite compté mais jamais affiché", () => {
    const empty = inspectTempsPage(`<html><head><title>Temps</title></head><body><p>Bienvenue</p></body></html>`);
    expect(empty).toMatchObject({ forms: [], searchFields: [], needsVehicle: false, needsOperation: false, explicitTimeRows: 0, times: [] });
    const t = inspectTempsPage(`<table><tr><th>Opération</th><th>Temps (h)</th></tr><tr><td>Vidange</td><td>0,8</td></tr></table>`);
    expect(t.explicitTimeRows).toBe(1);
    expect(t.times).toEqual([]);
  });

  it("classement réponse : connexion, externe, 403, page de login, GET réussi sans TM", () => {
    expect(classifyTempsResponse(302, "/index.html", "")).toMatchObject({ status: "page_connexion", redirectKind: "connexion" });
    expect(classifyTempsResponse(302, "https://evil.example/", "")).toMatchObject({ status: "redirection", redirectKind: "externe" });
    expect(classifyTempsResponse(403, null, "").status).toBe("acces_refuse");
    expect(classifyTempsResponse(200, null, `<form><input name="j_username"><input name="j_password"></form>`).status).toBe("page_connexion");
    const ok = classifyTempsResponse(200, null, `<title>Temps</title><form action="/Temps.html" method="get"><input name="immat"></form>`);
    expect(ok.status).toBe("page_lue_tm_non_recuperes");
    expect(ok.page!.times).toEqual([]);
  });
});

import { classifySource } from "../ixellio-labor-parse";
import { IXELLIO_FIXED_PAGES } from "../ixellio-labor-page.server";

describe("TM v3 — Gamme IXELL et nature des sources (fixtures synthétiques)", () => {
  it("allowlist fixe : deux pages exactes seulement", () => {
    expect(Object.values(IXELLIO_FIXED_PAGES).map((p) => p.url)).toEqual([
      "https://www.ixellio.fr/Temps.html?method=search", "https://www.ixellio.fr/GammeUniverselle.html?method=search"]);
  });

  it("page Temps réelle (elementGarageId + add/edit/remove) => éléments garage, exclue", () => {
    const p = inspectTempsPage(`<title>Ixellio Temps</title><form action="/Temps.html?method=search" method="post"><select name="elementGarageId"><option>1</option></select></form>
      <a href="/Temps.html?method=edit&tempsGarageId=12">Modifier</a><a href="/Temps.html?method=remove&tempsGarageId=12">Supprimer</a>
      <script>u="/ajax/Temps.html?method=addElement";</script>`);
    expect(p.sourceKind).toBe("elements_garage");
    expect(p.times).toEqual([]);
    expect(JSON.stringify(p)).not.toMatch(/"12"|tempsGarageId=12/);
  });

  it("Gamme générique avec durées sans véhicule => gamme garage possible, aucun TM", () => {
    const p = inspectTempsPage(`<title>Gamme universelle</title><h2>Gamme IXELL — forfaits</h2>
      <form action="/GammeUniverselle.html?method=search" method="get"><input name="libelle"><input name="_csrf" type="hidden" value="SEC"></form>
      <table><tr><th>Opération</th><th>Temps (h)</th></tr><tr><td>Vidange</td><td>0,5</td></tr></table>`);
    expect(p.sourceKind).toBe("gamme_garage_possible");
    expect(p.explicitTimeRows).toBe(1);
    expect(p.times).toEqual([]);
    expect(JSON.stringify(p)).not.toContain("SEC");
  });

  it("indices constructeur + champ véhicule => seulement « à confirmer », jamais validé", () => {
    const c = classifySource({ title: "Temps constructeur", headings: ["Barème constructeur"], links: [], forms: [], searchFields: [{ name: "vin", type: "text", hint: "vehicule" }] });
    expect(c.kind).toBe("constructeur_possible");
    expect(classifySource({ title: "Accueil", headings: [], links: [], forms: [], searchFields: [] }).kind).toBe("indetermine");
  });

  it("réponses Gamme : 200 lue, 302 connexion, 403 refus", () => {
    expect(classifyTempsResponse(200, null, `<title>Gamme</title>`, "Gamme IXELL").message).toMatch(/Gamme IXELL lue.*ni validé/);
    expect(classifyTempsResponse(302, "/login.html", "", "Gamme IXELL")).toMatchObject({ status: "page_connexion" });
    expect(classifyTempsResponse(403, null, "", "Gamme IXELL").message).toMatch(/Gamme IXELL/);
  });
});
