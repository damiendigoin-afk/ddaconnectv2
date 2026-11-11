import { describe, expect, it } from "vitest";
import { analyzeJsFlow } from "../ixellio-js-flow";
import { inspectTempsRemplacement } from "../ixellio-parts-tempsremp";

// Fixture synthétique reproduisant la FORME du source public (minifié, OK généré en chaîne).
const JS = `var interventionsMecaniqueType=new Array();var codesInterventionSelect="";var x_secret="TOK999";
function selectPiece(a,e){var b=document.getElementById("pieceTypeIntervention_"+a).value;if(b!=""){menuInterventions(null,a,true,b,false,null,null,null,e)}}
function menuInterventions(i,j,e,h,d,f,c,a,b){if(e){afficheMenuIntervention(i,j,[],h,d,c,a,b)}else{masqueMenuIntervention()}}
function afficheMenuIntervention(t,h,c){var A='<INPUT type="checkbox" onclick="javascript:selectCodeIntervention(\\'AA3\\')">';A+='<INPUT type="button" value="'+TXT_OK+'" onclick="javascript:valideInterventions(\\''+t+'\\')">';A+='<INPUT onclick="javascript:masqueMenuIntervention();">'}
function valideInterventions(e,h){var a=document.getElementById("divTempsRemplacement_"+h);a.style.display="block";masqueMenuIntervention()}
function masqueMenuIntervention(){codesInterventionSelect=""}
function saveSelectionToChiffrage(d,a,b){document.pieceRechercheForm.chiffrageId.value=d;document.pieceRechercheForm.method.value="addToChiffrage";document.pieceRechercheForm.submit()}
function buildTempsRedressage(d){var o=document.getElementById("pieceTempsRedressage_"+d);return o.value}`;

describe("v11 chaîne complète interventions", () => {
  const f = analyzeJsFlow(JS);
  const fn = (n: string) => f.functions.find((x) => x.name === n)!;
  it("menuInterventions analysée, OK → valideInterventions (pas save)", () => {
    expect(fn("menuInterventions")).toMatchObject({ exists: true, parse: "ok" });
    expect(fn("selectPiece").calls).toContain("menuInterventions");
    expect(f.okHandlers).toEqual(["valideInterventions"]);
    expect(f.okCallsSave).toBe("non déterminé");
    expect(fn("valideInterventions").ajax).toEqual([]);
  });
  it("envoi formulaire signalé, champs et action par nom seulement", () => {
    expect(fn("saveSelectionToChiffrage")).toMatchObject({ submits: true, submitMethods: ["addToChiffrage"] });
    expect(fn("saveSelectionToChiffrage").formFields).toContain("chiffrageId");
    expect(fn("buildTempsRedressage").timeRefs).toBe(true);
    expect(f.globals).toContain("interventionsMecaniqueType");
    expect(JSON.stringify(f)).not.toContain("TOK999");
  });
});

describe("v11 bloc divTempsRemplacement", () => {
  const html = `<table><tr id="lignePiece_884422" onclick="selectPiece('884422')"><td>GUIDAGE AIR ARMATURE AV</td><td>26.44 €</td></tr></table>
  <div id="divTempsRemplacement_884422" style="display:none">Temps remplacement : 42 min <input name="pieceTempsRemplacement_884422" type="text"></div>
  <div id="divTempsRemplacement_771" style="display: none">Temps 0,5</div>
  <script>pieceRechercheItems.put('884422', new Array('a'));</script>`;
  const d = inspectTempsRemplacement(html, ["GUIDAGE AIR ARMATURE AV"]);
  it("présence, masquage, unité, rattachement sans valeur", () => {
    expect(d.verdict).toBe("blocs temps présents");
    expect(d.blocks[0]).toMatchObject({ designation: "GUIDAGE AIR ARMATURE AV", mapping: "haute", hiddenByDefault: true, hasNumber: true, unit: "min" });
    expect(d.blocks[1]).toMatchObject({ mapping: "non vérifiée", unit: null, hasNumber: true });
    expect(d.itemsPutCalls).toBe(1);
    const j = JSON.stringify(d);
    for (const leak of ["42", "884422", "0,5"]) expect(j).not.toContain(leak);
  });
  it("absence de bloc", () => {
    expect(inspectTempsRemplacement("<p>rien</p>").verdict).toBe("aucun bloc temps dans la réponse");
  });
});
