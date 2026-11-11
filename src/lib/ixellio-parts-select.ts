/**
 * Diagnostic v9 (manager, lecture seule) : sélection d'une pièce → popup d'interventions.
 * Analyse la réponse de recherche DÉJÀ reçue : liaisons de clic sur les lignes prix groupées,
 * mots-clés et noms de fonctions dans les scripts inline, chemins internes allowlistés, fichiers JS
 * externes (chemin seul). Aucune requête, aucun clic. Jamais : HTML/JS brut, valeurs d'attributs,
 * identifiants, jetons, durées.
 */
import { parse } from "parse5";

import { nameShape, safeEndpoints, safeFunctions, type SafeEndpoint } from "./ixellio-parts-replace";

type Attr = { name: string; value: string };
type Node = { nodeName: string; tagName?: string; value?: string; attrs?: Attr[]; childNodes?: Node[]; parentNode?: Node | null };

export type SelectBinding = { level: string; event: string; functions: string[]; endpoints: SafeEndpoint[] };
export type SelectRow = {
  resultIndex: number;
  category: string | null;
  designation: string;
  mapping: "haute" | "non vérifiée";
  mappingReason: string;
  bindings: SelectBinding[];
  attrNames: string[];
  roles: string[];
  classHints: string[];
  pointerCursor: boolean;
  checkboxesInRow: number;
};
export type SelectDiag = {
  rows: SelectRow[];
  scripts: {
    inline: number;
    keywords: { word: string; count: number }[];
    functions: string[];
    endpoints: SafeEndpoint[];
    delegatedClickBindings: number;
    external: string[];
  };
  verdict: "liaison de clic détectée" | "aucune liaison de clic inline";
  warnings: string[];
};
type Grouped = { index: number; category: string | null; designation: string };

const SKIP = new Set(["style", "template", "noscript", "#comment"]);
const AMOUNT = /\d[.,]\d{2}\s*(?:€|EUR\b)/i;
const KEYWORDS: [string, RegExp][] = [
  ["Remplacer", /remplacer/gi], ["Réparer", /r[ée]parer/gi], ["Déposer", /d[ée]poser/gi], ["Contrôler", /contr[ôo]ler/gi],
  ["Régler", /r[ée]gler/gi], ["Afficher toutes", /afficher\s+toutes/gi], ["intervention", /intervention/gi], ["selection", /s[ée]lection/gi],
  ["popup", /popup/gi], ["popin", /popin/gi], ["chiffrage", /chiffrage/gi], ["temps", /\btemps\b/gi],
];
const FN_RE = /select|popup|popin|interv|chiffr|temps|remplac|piece|ligne|row|operation|dialog|modal/i;
const clean = (s: string) => s.replace(/[\s\u00a0\u202f]+/g, " ").trim();
const attr = (n: Node, k: string) => n.attrs?.find((a) => a.name === k)?.value ?? null;
function text(n: Node): string {
  if (SKIP.has(n.nodeName) || n.nodeName === "script") return "";
  if (n.nodeName === "#text") return n.value ?? "";
  return (n.childNodes ?? []).map(text).join(" ");
}
function walk(n: Node, f: (n: Node) => void) {
  if (SKIP.has(n.nodeName)) return;
  f(n);
  for (const c of n.childNodes ?? []) walk(c, f);
}
const cellsOf = (tr: Node) => (tr.childNodes ?? []).filter((c) => c.tagName === "td" || c.tagName === "th");
const handlers = (n: Node, level: string): SelectBinding[] =>
  (n.attrs ?? [])
    .filter((a) => /^on[a-z]+$/.test(a.name) || (a.name === "href" && /^javascript:/i.test(a.value)))
    .map((a) => ({ level, event: a.name === "href" ? "href:javascript" : a.name, functions: safeFunctions(a.value), endpoints: safeEndpoints(a.value) }));
const classHints = (n: Node) => (attr(n, "class") ?? "").split(/\s+/).filter((c) => c && /select|click|row|ligne|piece|hover|active|actif|interv|popup/i.test(c)).map((c) => c.replace(/\d{3,}/g, "#").slice(0, 30));

/** Chemin de script externe : interne IXELLIO seulement, sans requête ni fragment. */
export function safeScriptPath(src: string | null): string | null {
  if (!src) return null;
  let u: URL;
  try { u = new URL(src, "https://www.ixellio.fr/"); } catch { return null; }
  if (!/(^|\.)ixellio\.fr$/i.test(u.hostname)) return null;
  const p = u.pathname.replace(/\d{6,}/g, "#");
  return /^\/[\w./#-]{1,120}\.js$/i.test(p) ? p : null;
}

export function inspectSelectionPopup(html: string, grouped: Grouped[] = [], groupingHigh = false): SelectDiag {
  const doc = parse(html) as unknown as Node;
  const trs: Node[] = [];
  const inline: string[] = [];
  const external = new Set<string>();
  walk(doc, (n) => {
    if (n.tagName === "tr") trs.push(n);
    if (n.tagName === "script") {
      const p = safeScriptPath(attr(n, "src"));
      if (p && external.size < 15) external.add(p);
      else if (!attr(n, "src")) inline.push((n.childNodes ?? []).map((c) => c.value ?? "").join(""));
    }
  });
  const priceTrs = trs.filter((tr) => {
    const c = cellsOf(tr);
    return c.length >= 2 && !c.some((x) => x.childNodes?.some((k) => k.tagName === "table")) && AMOUNT.test(clean(text(c[c.length - 1]!)));
  });

  const rows: SelectRow[] = grouped.slice(0, 12).map((g) => {
    const hits = priceTrs.filter((tr) => clean(text(cellsOf(tr)[0]!)).slice(0, 80) === g.designation);
    const base = { resultIndex: g.index, category: g.category, designation: g.designation };
    const empty = { bindings: [], attrNames: [], roles: [], classHints: [], pointerCursor: false, checkboxesInRow: 0 };
    if (!groupingHigh) return { ...base, ...empty, mapping: "non vérifiée", mappingReason: "groupement non validé" };
    if (hits.length !== 1) return { ...base, ...empty, mapping: "non vérifiée", mappingReason: `${hits.length} ligne(s) prix pour cette désignation` };
    const tr = hits[0]!;
    const bindings: SelectBinding[] = [];
    const attrNames = new Set<string>(), roles = new Set<string>(), cls = new Set<string>();
    let pointer = false, checkboxes = 0;
    const look = (n: Node, level: string) => {
      bindings.push(...handlers(n, level));
      (n.attrs ?? []).forEach((a) => attrNames.size < 20 && attrNames.add(`${level}:${a.name.replace(/\d{3,}/g, "#")}`));
      const r = attr(n, "role"); if (r && /^[a-z]{2,20}$/.test(r)) roles.add(r);
      classHints(n).forEach((c) => cls.add(c));
      if (/cursor\s*:\s*pointer/i.test(attr(n, "style") ?? "")) pointer = true;
    };
    walk(tr, (n) => {
      if (!n.tagName) return;
      look(n, n === tr ? "ligne" : n.tagName === "td" ? "cellule" : n.tagName);
      if (n.tagName === "input" && /checkbox/i.test(attr(n, "type") ?? "")) checkboxes++;
    });
    let p = tr.parentNode, depth = 0;
    while (p && depth < 4) { if (p.tagName) { look(p, `parent${depth + 1}:${p.tagName}`); depth++; } p = p.parentNode; }
    return { ...base, mapping: "haute", mappingReason: "désignation unique parmi les lignes prix, groupement validé", bindings: bindings.slice(0, 12), attrNames: [...attrNames], roles: [...roles], classHints: [...cls].slice(0, 10), pointerCursor: pointer, checkboxesInRow: checkboxes };
  });

  const js = inline.join("\n");
  const fns = new Set<string>();
  for (const m of js.matchAll(/function\s+([A-Za-z_$][\w$]{1,40})|([A-Za-z_$][\w$]{1,40})\s*[=:]\s*function|([A-Za-z_$][\w$]{2,40})\s*\(/g)) {
    const f = m[1] ?? m[2] ?? m[3]!;
    if (FN_RE.test(f) && fns.size < 15) fns.add(f);
  }
  const scripts = {
    inline: inline.length,
    keywords: KEYWORDS.map(([word, re]) => ({ word, count: (js.match(re) ?? []).length })),
    functions: [...fns],
    endpoints: safeEndpoints(js),
    delegatedClickBindings: (js.match(/\.(?:on|live|delegate|bind)\(\s*['"](?:click|dblclick|tap|touchend)|\.click\(\s*function|addEventListener\(\s*['"](?:click|touchend)/g) ?? []).length,
    external: [...external],
  };
  const any = rows.some((r) => r.bindings.length);
  const warnings: string[] = [];
  if (!any) warnings.push("Aucun gestionnaire de clic inline sur les lignes prix ni leurs 4 parents : liaison probablement posée par script (délégation) ou fichier JS externe.");
  if (scripts.delegatedClickBindings) warnings.push(`${scripts.delegatedClickBindings} liaison(s) de clic par script détectée(s) — cible exacte non déterminable en statique.`);
  if (scripts.external.length) warnings.push("Prochaine cible lecture seule possible : un des fichiers JS externes listés (aucun téléchargé ici).");
  warnings.push("Popup d'interventions absente du HTML statique : attendu si construite dynamiquement. Aucun clic, aucun OK, aucune durée.");
  return { rows, scripts, verdict: any ? "liaison de clic détectée" : "aucune liaison de clic inline", warnings };
}
