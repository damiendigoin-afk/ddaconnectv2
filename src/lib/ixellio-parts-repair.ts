/**
 * Diagnostic v8 (manager, lecture seule) : lignes « Réparation » et sémantique des contrôles voisins,
 * dans la réponse de recherche IXELLIO DÉJÀ reçue. Aucune requête, aucun clic, aucune écriture.
 * Jamais exposés : HTML brut, contenu de script, valeurs d'attributs/options/champs, identifiants,
 * jetons, montants ou durées. Seulement noms assainis, types, libellés d'options courts et masqués,
 * booléens, noms de fonctions et chemins internes + paramètre method allowlistés.
 */
import { parse } from "parse5";

import { safeLabel } from "./ixellio-parts-parse";
import { hasRealNumber, nameShape, safeEndpoints, safeFunctions, visibleTextNoControls, type SafeEndpoint } from "./ixellio-parts-replace";

type Attr = { name: string; value: string };
type Node = { nodeName: string; tagName?: string; value?: string; attrs?: Attr[]; childNodes?: Node[]; content?: Node; parentNode?: Node | null };

export type RepairControl = {
  tag: "input" | "select" | "textarea" | "button";
  type: string;
  nameShape: string | null;
  /** Catégorie générique seulement (jamais le texte du placeholder/title/aria-label). */
  hintCategory: "temps" | "remplacement" | "réparation" | "taux/niveau" | "autre" | "aucun";
  valuePresent: boolean;
  valueNumeric: boolean;
  options: { count: number; labels: string[]; selectedLabel: string | null; truncated: boolean } | null;
  handlers: { event: string; functions: string[]; endpoints: SafeEndpoint[] }[];
  attrNames: string[];
};
export type RepairRow = {
  index: number;
  mapping: { status: "vérifiée" | "non vérifiée"; resultIndex: number | null; category: string | null; designation: string | null; reason: string };
  cells: number;
  filledCells: number;
  numericInText: boolean;
  unit: "minutes" | "heures" | "UT" | "aucune unité affichée";
  controls: RepairControl[];
  optionFlags: { remplacer: boolean; remplacement: boolean; t1t2t3: boolean; reparation: boolean; temps: boolean };
  customCheckbox: { roleCheckbox: number; ariaChecked: number; dataAttrNames: string[]; classHints: string[] };
  adjacentRows: string[];
};
export type RepairDiag = {
  rows: RepairRow[];
  outside: { remplacTextOccurrences: number; remplacInAttributes: number; remplacInOptions: number; roleCheckbox: number; ariaChecked: number; checkboxInputs: number; classHints: string[] };
  warnings: string[];
};
type GroupedResult = { index: number; category: string | null; designation: string; amount: number };

const SKIP = new Set(["script", "style", "template", "noscript", "#comment"]);
const AMOUNT = /\d[.,]\d{2}\s*(?:€|EUR\b)/i;
const REF = /r[ée]f[ée]rence\s*:/i;
const clean = (s: string) => s.replace(/[\s\u00a0\u202f]+/g, " ").trim();
const attr = (n: Node, k: string) => n.attrs?.find((a) => a.name === k)?.value ?? null;
function text(n: Node): string {
  if (SKIP.has(n.nodeName)) return "";
  if (n.nodeName === "#text") return n.value ?? "";
  return (n.childNodes ?? []).map(text).join(" ");
}
function walk(n: Node, f: (n: Node) => void) {
  if (SKIP.has(n.nodeName) && n.nodeName !== "script") return;
  f(n);
  for (const c of n.childNodes ?? []) walk(c, f);
}
const cellsOf = (tr: Node) => (tr.childNodes ?? []).filter((c) => c.tagName === "td" || c.tagName === "th");
const ancestors = (n: Node) => { const a: Node[] = []; for (let p: Node | null | undefined = n; p; p = p.parentNode) a.push(p); return a; };

/** Libellé d'option : court, masqué (réf, VIN, plaque, e-mail, tél, codes), nombres masqués sauf T1/T2/T3. */
export function safeOptionLabel(raw: string, searched = ""): string {
  let t = clean(raw)
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, "[vin]")
    .replace(/\b[A-Z]{2}[- ]?\d{3}[- ]?[A-Z]{2}\b/gi, "[immat]");
  t = safeLabel(t, searched, 30);
  return t.replace(/\b(?!T[123]\b)([A-Za-z]*)\d+(?:[.,]\d+)?/g, (_m, p: string) => `${p}#`);
}
const flagsOf = (s: string) => ({
  remplacer: /remplacer/i.test(s), remplacement: /remplacement/i.test(s), t1t2t3: /\bT[123]\b/.test(s), reparation: /r[ée]paration/i.test(s), temps: /\btemps\b/i.test(s),
});
function hintCategory(n: Node): RepairControl["hintCategory"] {
  const s = [attr(n, "placeholder"), attr(n, "title"), attr(n, "aria-label")].filter(Boolean).join(" ");
  if (!s) return "aucun";
  if (/remplac/i.test(s)) return "remplacement";
  if (/temps|dur[ée]e|minute|heure/i.test(s)) return "temps";
  if (/r[ée]par/i.test(s)) return "réparation";
  if (/taux|niveau|\bT[123]\b/i.test(s)) return "taux/niveau";
  return "autre";
}
const classHints = (n: Node): string[] =>
  (attr(n, "class") ?? "").split(/\s+/).filter((c) => /check|toggle|switch|remplac|replace|select|niv|temps|tps/i.test(c)).map((c) => c.replace(/\d{3,}/g, "#").slice(0, 30));
const dataNames = (n: Node) => (n.attrs ?? []).filter((a) => a.name.startsWith("data-")).map((a) => a.name.replace(/\d{3,}/g, "#"));
const handlersOf = (n: Node) =>
  (n.attrs ?? [])
    .filter((a) => /^on[a-z]+$/.test(a.name) || (a.name === "href" && /^javascript:/i.test(a.value)))
    .map((a) => ({ event: a.name === "href" ? "href:javascript" : a.name, functions: safeFunctions(a.value), endpoints: safeEndpoints(a.value) }));

function controlOf(n: Node, searched: string): RepairControl {
  const tag = n.tagName as RepairControl["tag"];
  const type = tag === "input" ? (attr(n, "type") ?? "text").toLowerCase() : tag;
  let options: RepairControl["options"] = null;
  if (tag === "select") {
    const opts: Node[] = [];
    walk(n, (x) => { if (x.tagName === "option") opts.push(x); });
    const labels = opts.slice(0, 15).map((o) => safeOptionLabel(text(o), searched));
    const sel = opts.find((o) => o.attrs?.some((a) => a.name === "selected"));
    options = { count: opts.length, labels, selectedLabel: sel ? safeOptionLabel(text(sel), searched) : null, truncated: opts.length > 15 };
  }
  const v = tag === "input" || tag === "button" ? attr(n, "value") ?? "" : tag === "textarea" ? text(n) : "";
  return {
    tag, type, nameShape: nameShape(attr(n, "name")), hintCategory: hintCategory(n),
    valuePresent: Boolean(v.trim()), valueNumeric: hasRealNumber(v),
    options, handlers: handlersOf(n),
    attrNames: [...new Set((n.attrs ?? []).map((a) => a.name.replace(/\d{3,}/g, "#")))].slice(0, 15),
  };
}

export function inspectRepairRows(html: string, searched = "", grouped: GroupedResult[] = [], groupingHigh = false): RepairDiag {
  const doc = parse(html) as unknown as Node;
  const trs: Node[] = [];
  const all: Node[] = [];
  walk(doc, (n) => { all.push(n); if (n.tagName === "tr") trs.push(n); });
  const leafLabel = (tr: Node) => clean(cellsOf(tr)[0] ? text(cellsOf(tr)[0]!) : "");
  const repairTrs = trs.filter((tr) => /^r[ée]paration\b/i.test(leafLabel(tr)) && !cellsOf(tr).some((c) => c.childNodes?.some((k) => k.tagName === "table")));

  // Lignes prix des résultats validés (désignation + montant, uniques) et ancres Référence.
  const priceTrs = trs.flatMap((tr) => {
    const c = cellsOf(tr);
    if (c.length < 2) return [];
    const lab = clean(text(c[0]!));
    const res = grouped.filter((g) => g.designation === lab.slice(0, 80) && AMOUNT.test(clean(text(c[c.length - 1]!))));
    return res.length === 1 ? [{ tr, res: res[0]! }] : [];
  });
  const dupDesig = new Set(grouped.filter((g, i) => grouped.findIndex((o) => o.designation === g.designation) !== i).map((g) => g.designation));
  const refTables = all.filter((n) => n.tagName === "table" && REF.test(clean(text(n))) && !all.some((o) => o !== n && o.tagName === "table" && ancestors(o).includes(n) && REF.test(clean(text(o)))));

  const rows: RepairRow[] = repairTrs.slice(0, 12).map((tr, i) => {
    let mapping: RepairRow["mapping"] = { status: "non vérifiée", resultIndex: null, category: null, designation: null, reason: "groupement des résultats non validé" };
    if (groupingHigh && grouped.length) {
      mapping.reason = "aucun bloc exclusif ne contient une seule ligne prix et une seule Référence";
      for (const a of ancestors(tr).slice(1)) {
        const p = priceTrs.filter((x) => ancestors(x.tr).includes(a));
        const r = refTables.filter((t) => ancestors(t).includes(a));
        const rep = repairTrs.filter((x) => ancestors(x).includes(a));
        if (!p.length && !r.length) continue;
        if (p.length === 1 && r.length === 1 && rep.length === 1 && !dupDesig.has(p[0]!.res.designation)) {
          const g = p[0]!.res;
          mapping = { status: "vérifiée", resultIndex: g.index, category: g.category, designation: g.designation, reason: "bloc DOM exclusif (1 prix, 1 Référence, 1 ligne Réparation)" };
        } else mapping.reason = `premier bloc englobant ambigu (${p.length} prix, ${r.length} Référence, ${rep.length} Réparation)`;
        break;
      }
    }
    const cells = cellsOf(tr);
    const rest = cells.slice(1).map((c) => clean(text(c)));
    // Texte visible direct seulement : options de liste (T1/T2/T3), saisies et boutons exclus.
    const joined = cells.slice(1).map((c) => clean(visibleTextNoControls(c))).join(" ");
    const controls: RepairControl[] = [];
    const custom = { roleCheckbox: 0, ariaChecked: 0, dataAttrNames: new Set<string>(), classHints: new Set<string>() };
    const scan = (scope: Node) => walk(scope, (x) => {
      if (["input", "select", "textarea", "button"].includes(x.tagName ?? "") && scope === tr && controls.length < 8) controls.push(controlOf(x, searched));
      if (attr(x, "role") === "checkbox") custom.roleCheckbox++;
      if (x.attrs?.some((a) => a.name === "aria-checked")) custom.ariaChecked++;
      dataNames(x).forEach((d) => custom.dataAttrNames.size < 10 && custom.dataAttrNames.add(d));
      classHints(x).forEach((c) => custom.classHints.size < 10 && custom.classHints.add(c));
    });
    scan(tr);
    const sib = (tr.parentNode?.childNodes ?? []).filter((c) => c.tagName === "tr");
    const k = sib.indexOf(tr);
    const adj = [sib[k - 1], sib[k + 1]].filter(Boolean) as Node[];
    adj.forEach(scan);
    const optText = controls.flatMap((c) => c.options?.labels ?? []).join(" ");
    return {
      index: i + 1, mapping, cells: cells.length,
      filledCells: rest.filter((r) => /[\p{L}\d]/u.test(r)).length,
      numericInText: hasRealNumber(joined),
      unit: /\b(min|mn|minutes?)\b/i.test(joined) ? "minutes" : /\d\s*h\b|\bheures?\b/i.test(joined) ? "heures" : /\bUT\b/.test(joined) ? "UT" : "aucune unité affichée",
      controls, optionFlags: flagsOf(optText),
      customCheckbox: { roleCheckbox: custom.roleCheckbox, ariaChecked: custom.ariaChecked, dataAttrNames: [...custom.dataAttrNames], classHints: [...custom.classHints] },
      adjacentRows: adj.map((a) => safeLabel(leafLabel(a), searched, 25)).map((s) => s.replace(/\d+(?:[.,]\d+)?/g, "#")),
    };
  });

  // Hors lignes Réparation.
  const inRepair = (n: Node) => repairTrs.some((tr) => ancestors(n).includes(tr));
  const outside = { remplacTextOccurrences: 0, remplacInAttributes: 0, remplacInOptions: 0, roleCheckbox: 0, ariaChecked: 0, checkboxInputs: 0, classHints: new Set<string>() };
  for (const n of all) {
    if (n.nodeName === "script" || inRepair(n)) continue;
    if (n.nodeName === "#text" && !SKIP.has(n.parentNode?.nodeName ?? "") && /remplac/i.test(n.value ?? "")) {
      if (n.parentNode?.tagName === "option") outside.remplacInOptions++;
      else outside.remplacTextOccurrences++;
    }
    if (!n.tagName) continue;
    if (n.attrs?.some((a) => ["title", "aria-label", "placeholder", "value", "alt"].includes(a.name) && /remplac/i.test(a.value))) outside.remplacInAttributes++;
    if (attr(n, "role") === "checkbox") outside.roleCheckbox++;
    if (n.attrs?.some((a) => a.name === "aria-checked")) outside.ariaChecked++;
    if (n.tagName === "input" && (attr(n, "type") ?? "").toLowerCase() === "checkbox") outside.checkboxInputs++;
    classHints(n).forEach((c) => outside.classHints.size < 10 && outside.classHints.add(c));
  }

  const warnings: string[] = [];
  if (!rows.length) warnings.push("Aucune ligne « Réparation » dans la réponse.");
  if (rows.some((r) => r.mapping.status !== "vérifiée")) warnings.push("Rattachement ligne Réparation ↔ résultat non vérifié pour au moins une ligne (aucune association par simple ordre).");
  if (rows.some((r) => r.numericInText && r.unit === "aucune unité affichée") || rows.some((r) => r.controls.some((c) => c.valueNumeric)))
    warnings.push("Valeur numérique présente sans unité établie : aucune durée ni minute n'est affirmée (valeur non affichée).");
  if (!rows.some((r) => r.optionFlags.remplacer || r.optionFlags.remplacement)) warnings.push("Aucune option « Remplacer/Remplacement » dans les listes des lignes Réparation de cette réponse.");
  warnings.push("Lignes Redressage/Réparation/Peinture : chiffrage carrosserie probable tant qu'aucune source TM constructeur n'est établie.");
  return { rows, outside: { ...outside, classHints: [...outside.classHints] }, warnings };
}
