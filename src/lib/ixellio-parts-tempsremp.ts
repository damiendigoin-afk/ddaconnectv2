/**
 * Diagnostic v11 (manager, lecture seule) — section L, volet page.
 * Le source public intervention.js / pieceRecherche.js montre que le bouton OK (valideInterventions)
 * n'appelle aucun réseau : il rend visibles des blocs déjà présents dans la réponse de recherche,
 * dont `divTempsRemplacement_<id>`. On inventorie donc ces blocs dans la réponse DÉJÀ reçue.
 * Jamais : HTML brut, identifiants, valeurs numériques. Seulement présence, visibilité, unité, forme.
 */
import { parse } from "parse5";

import { nameShape } from "./ixellio-parts-replace";

type Attr = { name: string; value: string };
type Node = { nodeName: string; tagName?: string; value?: string; attrs?: Attr[]; childNodes?: Node[] };

export type TempsBlock = {
  index: number;
  designation: string | null;
  mapping: "haute" | "non vérifiée";
  hiddenByDefault: boolean;
  hasNumber: boolean;
  unit: "min" | "h" | null;
  inputs: { name: string | null; type: string }[];
  labelWords: string[];
};
export type TempsRempDiag = {
  blocks: TempsBlock[];
  rowsWithPieceId: number;
  itemsPutCalls: number;
  verdict: "blocs temps présents" | "aucun bloc temps dans la réponse";
  warnings: string[];
};

const attr = (n: Node, k: string) => n.attrs?.find((a) => a.name === k)?.value ?? null;
const clean = (s: string) => s.replace(/[\s\u00a0\u202f]+/g, " ").trim();
function text(n: Node): string {
  if (n.nodeName === "script" || n.nodeName === "style" || n.nodeName === "#comment") return "";
  if (n.nodeName === "#text") return n.value ?? "";
  return (n.childNodes ?? []).map(text).join(" ");
}
function walk(n: Node, f: (n: Node) => void) { f(n); for (const c of n.childNodes ?? []) walk(c, f); }
const SAFE_WORDS = /^(temps|remplacement|remplacer|min|mn|minutes?|h|heures?|mo|t[123]|main|d'?oeuvre|œuvre|bar[èe]me|constructeur|dur[ée]e)$/i;

export function inspectTempsRemplacement(html: string, designations: string[] = []): TempsRempDiag {
  const doc = parse(html) as unknown as Node;
  const rows = new Map<string, string>();
  const blocks: { id: string; n: Node }[] = [];
  let itemsPutCalls = 0;
  walk(doc, (n) => {
    const id = attr(n, "id") ?? "";
    let m = /^lignePiece_(.+)$/.exec(id);
    if (m) rows.set(m[1]!, clean(text(n)));
    m = /^divTempsRemplacement_(.+)$/.exec(id);
    if (m) blocks.push({ id: m[1]!, n });
    if (n.nodeName === "script") itemsPutCalls += ((n.childNodes ?? []).map((c) => c.value ?? "").join("").match(/pieceRechercheItems\.put\s*\(/g) ?? []).length;
  });
  const out: TempsBlock[] = blocks.slice(0, 20).map(({ id, n }, i) => {
    const t = clean(text(n));
    const row = rows.get(id);
    const hits = row ? designations.filter((d) => d && row.includes(d)) : [];
    const inputs: TempsBlock["inputs"] = [];
    walk(n, (c) => { if ((c.tagName === "input" || c.tagName === "select") && inputs.length < 6) inputs.push({ name: nameShape(attr(c, "name") ?? attr(c, "id")), type: c.tagName === "select" ? "select" : (attr(c, "type") ?? "text").toLowerCase() }); });
    const style = (attr(n, "style") ?? "").replace(/\s/g, "").toLowerCase();
    return {
      index: i + 1,
      designation: hits.length === 1 ? hits[0]! : null,
      mapping: hits.length === 1 ? "haute" : "non vérifiée",
      hiddenByDefault: style.includes("display:none") || style.includes("visibility:hidden"),
      hasNumber: /\d/.test(t),
      unit: /\d\s*(?:min\b|mn\b|minutes?\b)/i.test(t) ? "min" : /\d\s*(?:h\b|heures?\b)/i.test(t) ? "h" : null,
      inputs,
      labelWords: [...new Set(t.split(/[\s:|()]+/).filter((w) => SAFE_WORDS.test(w)).map((w) => w.toLowerCase()))].slice(0, 8),
    };
  });
  const warnings = [
    "Source public vérifié : OK → valideInterventions, sans appel réseau ; il affiche divTempsRemplacement_ uniquement si Réparer ou Redresser est coché.",
    "Aucune valeur numérique n'est affichée ici ; présence de chiffre et unité seulement.",
  ];
  if (!out.length) warnings.push("Aucun bloc divTempsRemplacement_ dans cette réponse : le temps n'est pas dans la page de recherche (peut-être dans l'écran chiffrage après envoi).");
  if (out.some((b) => b.hasNumber && !b.unit)) warnings.push("Chiffre sans unité explicite : ne pas l'interpréter comme une durée.");
  warnings.push("Rattachement constructeur/barème non établi : bloc lié aux interventions carrosserie (Réparer/Redresser) dans le source.");
  return { blocks: out, rowsWithPieceId: rows.size, itemsPutCalls, verdict: out.length ? "blocs temps présents" : "aucun bloc temps dans la réponse", warnings };
}
