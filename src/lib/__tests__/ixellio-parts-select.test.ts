import { describe, expect, it } from "vitest";
import { inspectSelectionPopup, safeScriptPath } from "../ixellio-parts-select";
import { groupIxellioResults } from "../ixellio-parts-results";

const card = (cat: string, des: string, click: boolean) => `<table><tr><td>
<table><tr><td>${cat}</td><td></td><td><img src="x.gif"></td></tr></table>
<table><tr class="ligneSelectionnable"${click ? ` onclick="selectionnerPiece(this,'778899');ouvrirPopupInterventions('/ChiffragePiece.html?method=listeInterventions&id=778899&token=TOK123')"` : ""} style="cursor:pointer"><td>${des}</td><td>26.44 €</td></tr></table>
<table><tr><td>Référence : 214992066R</td></tr></table>
</td></tr></table>`;
const page = (click: boolean, js = "") => `<p>Sélectionnez votre pièce parmi les 3 résultat(s) exact(s)</p>
<table><tr><td>${card("ARMATURE AV", "GUIDAGE AIR ARMATURE AV", click)}</td></tr><tr><td>${card("RÉFÉRENCE(S) MÉTIER(S)", "CONVERGENT G", click)}</td></tr><tr><td>${card("CARROSSERIE", "DEFLECTEUR", click)}</td></tr></table>
<script src="/js/chiffrage.js?v=123456&session=ABC"></script><script src="https://evil.example/x.js"></script>
<script>${js}</script>`;
const JS = `function afficherPopupIntervention(id){ var l=['Remplacer','Réparer','Déposer / Poser','Contrôler','Régler','Afficher toutes les interventions']; $.post('/ajax/ChiffragePiece.html?method=getTemps&csrf=SECRETX'); var tel='0612345678'; }
$(document).on('click', 'tr.ligneSelectionnable', function(){ afficherPopupIntervention(1) });`;

const run = (html: string) => { const g = groupIxellioResults(html, "214992066R"); return inspectSelectionPopup(html, g.results, g.groupingConfidence === "haute"); };

describe("diagnostic v9 sélection → popup", () => {
  it("3 lignes rattachées, gestionnaire inline : noms et chemin + method seulement", () => {
    const d = run(page(true, JS));
    expect(d.rows).toHaveLength(3);
    expect(d.rows.every((r) => r.mapping === "haute")).toBe(true);
    expect(d.verdict).toBe("liaison de clic détectée");
    const b = d.rows[0]!.bindings.find((x) => x.level === "ligne")!;
    expect(b.functions).toEqual(expect.arrayContaining(["selectionnerPiece", "ouvrirPopupInterventions"]));
    expect(b.endpoints).toEqual([{ path: "/ChiffragePiece.html", method: "listeInterventions" }]);
    expect(d.rows[0]!.pointerCursor).toBe(true);
    expect(d.rows[0]!.classHints).toContain("ligneSelectionnable");
  });

  it("scripts : mots-clés, fonctions, liaison déléguée, JS externe interne sans requête", () => {
    const d = run(page(false, JS));
    const k = Object.fromEntries(d.scripts.keywords.map((x) => [x.word, x.count]));
    expect(k).toMatchObject({ Remplacer: 1, Réparer: 1, Déposer: 1, Contrôler: 1, Régler: 1, "Afficher toutes": 1 });
    expect(d.scripts.functions).toContain("afficherPopupIntervention");
    expect(d.scripts.delegatedClickBindings).toBe(1);
    expect(d.scripts.external).toEqual(["/js/chiffrage.js"]);
    expect(d.scripts.endpoints).toContainEqual({ path: "/ajax/ChiffragePiece.html", method: "getTemps" });
  });

  it("négatif : aucun gestionnaire inline", () => {
    const d = run(page(false));
    expect(d.verdict).toBe("aucune liaison de clic inline");
    expect(d.rows.every((r) => r.bindings.length === 0)).toBe(true);
  });

  it("aucune fuite : JS brut, valeurs, jetons, identifiants, réf", () => {
    const json = JSON.stringify(run(page(true, JS)));
    for (const leak of ["778899", "TOK123", "SECRETX", "0612345678", "123456", "ABC", "evil", "214992066R", "$.post", "function("]) expect(json).not.toContain(leak);
  });

  it("sans groupement validé : rattachement non vérifié", () => {
    const g = groupIxellioResults(page(true), "214992066R");
    expect(inspectSelectionPopup(page(true), g.results, false).rows.every((r) => r.mapping === "non vérifiée")).toBe(true);
  });

  it("chemin de script : hôte tiers refusé", () => {
    expect(safeScriptPath("https://cdn.other.com/a.js")).toBeNull();
    expect(safeScriptPath("scripts/app.js?x=1")).toBe("/scripts/app.js");
  });
});
