/**
 * Diagnostic v7 (manager, lecture seule) : option « Remplacer » / temps dans la réponse de recherche
 * IXELLIO DÉJÀ reçue. Aucune requête, aucun clic. Ne renvoie jamais : HTML brut, contenu de script,
 * valeurs d'attributs, identifiants, jetons, durées. Seulement des noms (assainis), types, chemins
 * relatifs + paramètre method allowlistés, et indicateurs d'unité.
 */
import { parse } from "parse5";

import { safeLabel } from "./ixellio-parts-parse";

type Attr = { name: string; value: string };
type Node = { nodeName: string; tagName?: string; value?: string; attrs?: Attr[]; childNodes?: Node[]; content?: Node; parentNode?: Node | null };

export type SafeEndpoint = { path: string; method: string | null };
export type ReplaceControl = {
  index: number;
  /** Désignation de la ligne/carte la plus proche (masquée), ou null si indéterminable. */
  designation: string | null;
  designationSource: "même ligne" | "ligne de prix précédente" | "indéterminée";
  tag: string;
  type: string | null;
  label: string;
  checkedDefault: boolean | null;
  disabled: boolean;
  hasId: boolean;
  nameShape: string | null;
  attrNames: string[];
  handlers: { event: string; functions: string[]; endpoints: SafeEndpoint[] }[];
  form: { method: string; action: SafeEndpoint | null } | null;
};
export type TimeRow = {
  label: "Redressage" | "Réparation" | "Peinture" | "Temps" | "Remplacement";
  cells: number;
  filledCells: number;
  numericPresent: boolean;
  unit: "minutes" | "heures" | "UT" | "aucune unité affichée" | "vide";
  inputs: { type: string; nameShape: string | null }[];
};
export type ReplaceDiag = {
  controls: ReplaceControl[];
  otherCheckboxes: number;
  remplacerTextOccurrences: number;
  scripts: { count: number; mentionsRemplac: boolean; functions: string[]; endpoints: SafeEndpoint[] };
  timeRows: TimeRow[];
  warnings: string[];
};

const SKIP = new Set(["script", "style", "template", "noscript", "#comment"]);
const KW = new Set(["if", "for", "while", "switch", "return", "function", "typeof", "new", "catch", "var", "let", "const", "this", "alert", "confirm"]);
const MAX = 12;

const attr = (n: Node, k: string) => n.attrs?.find((a) => a.name === k)?.value ?? null;
function text(n: Node): string {
  if (SKIP.has(n.nodeName)) return "";
  if (n.nodeName === "#text") return n.value ?? "";
  return (n.childNodes ?? []).map(text).join(" ");
}
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const up = (n: Node, tag: string): Node | null => {
  for (let p = n.parentNode; p; p = p.parentNode) if (p.tagName === tag) return p;
  return null;
};
function walk(n: Node, f: (n: Node) => void) {
  f(n);
  for (const c of n.childNodes ?? []) walk(c, f);
  if (n.content) walk(n.content, f);
}

/** Nom de champ assaini : suites de 3+ chiffres et segments hexa/longs masqués. */
export function nameShape(name: string | null): string | null {
  if (!name) return null;
  const s = name.replace(/\d{3,}/g, "#").replace(/[A-Fa-f0-9]{12,}/g, "#").replace(/[^\w.#[\]-]/g, "");
  return s.slice(0, 40) || null;
}

/** Chemins internes allowlistés (/xxx.html ou /ajax/xxx.html) + paramètre method seulement. */
export function safeEndpoints(js: string): SafeEndpoint[] {
  const out = new Map<string, SafeEndpoint>();
  const re = /(?:^|[^\w/.:])(\/?(?:ajax\/)?[A-Z][A-Za-z]{2,40}\.html)(?:\?([^'"\s<>]*))?/g;
  for (const m of js.matchAll(re)) {
    const path = `/${m[1]!.replace(/^\//, "")}`;
    const method = m[2]?.match(/(?:^|&)method=([A-Za-z]\w{0,40})/)?.[1] ?? null;
    out.set(`${path}|${method}`, { path, method });
    if (out.size >= MAX) break;
  }
  return [...out.values()];
}

export function safeFunctions(js: string): string[] {
  const out = new Set<string>();
  for (const m of js.matchAll(/([A-Za-z_$][\w$]{1,40})\s*\(/g)) {
    if (!KW.has(m[1]!)) out.add(m[1]!);
    if (out.size >= 6) break;
  }
  return [...out];
}

function labelFor(n: Node, byFor: Map<string, string>, searched: string): string {
  const id = attr(n, "id");
  if (id && byFor.has(id)) return safeLabel(byFor.get(id)!, searched);
  const lab = up(n, "label");
  if (lab) return safeLabel(text(lab), searched);
  const val = attr(n, "value");
  if (n.tagName !== "input" && val) return safeLabel(val, searched);
  const cell = up(n, "td") ?? up(n, "th");
  return cell ? safeLabel(text(cell), searched) : "";
}

export function inspectReplaceControls(html: string, searched = ""): ReplaceDiag {
  const doc = parse(html) as unknown as Node;
  const byFor = new Map<string, string>();
  const scriptsJs: string[] = [];
  const order: Node[] = [];
  let remplacerText = 0;
  walk(doc, (n) => {
    if (n.tagName === "label" && attr(n, "for")) byFor.set(attr(n, "for")!, text(n));
    if (n.tagName === "script") scriptsJs.push((n.childNodes ?? []).map((c) => c.value ?? "").join(""));
    if (n.nodeName === "#text" && !(n.parentNode && SKIP.has(n.parentNode.nodeName)) && /remplac/i.test(n.value ?? "")) remplacerText++;
    order.push(n);
  });

  const controls: ReplaceControl[] = [];
  const timeRows: TimeRow[] = [];
  let otherCheckboxes = 0;
  let lastPriceRow: string | null = null;
  const warnings: string[] = [];

  for (const n of order) {
    if (n.tagName === "tr") {
      const cells = (n.childNodes ?? []).filter((c) => c.tagName === "td" || c.tagName === "th");
      const first = clean(cells[0] ? text(cells[0]) : "");
      if (cells.length >= 2 && /\d[.,]\d{2}\s*€/.test(clean(text(n))) && first && !/€/.test(first)) lastPriceRow = safeLabel(first, searched);
      const tm = first.match(/^(Redressage|Réparation|Peinture|Temps|Remplacement)\b/i);
      if (tm) {
        const rest = cells.slice(1).map((c) => clean(text(c)));
        const joined = rest.join(" ");
        const unit: TimeRow["unit"] = /\b(min|mn|minutes?)\b/i.test(joined)
          ? "minutes"
          : /\d\s*h\b|\bheures?\b/i.test(joined)
            ? "heures"
            : /\bUT\b/.test(joined)
              ? "UT"
              : rest.some((r) => r) ? "aucune unité affichée" : "vide";
        const inputs: TimeRow["inputs"] = [];
        walk(n, (x) => {
          if ((x.tagName === "input" || x.tagName === "select") && inputs.length < 6) inputs.push({ type: x.tagName === "select" ? "select" : (attr(x, "type") ?? "text"), nameShape: nameShape(attr(x, "name")) });
        });
        const label = (tm[1]![0]!.toUpperCase() + tm[1]!.slice(1).toLowerCase()) as TimeRow["label"];
        if (timeRows.length < MAX) timeRows.push({ label: label === "Réparation" || /^r.paration$/i.test(label) ? "Réparation" : label, cells: cells.length, filledCells: rest.filter((r) => /[\p{L}\d]/u.test(r)).length, numericPresent: /\d/.test(joined), unit, inputs });
      }
    }
    if (!["input", "button", "a", "select"].includes(n.tagName ?? "")) continue;
    const type = n.tagName === "input" ? (attr(n, "type") ?? "text").toLowerCase() : null;
    const label = labelFor(n, byFor, searched);
    const nm = attr(n, "name") ?? "";
    const isReplace = /remplac/i.test(label) || /remplac|replace/i.test(nm) || /remplac/i.test(attr(n, "id") ?? "");
    if (!isReplace) {
      if (type === "checkbox") otherCheckboxes++;
      continue;
    }
    if (controls.length >= MAX) continue;
    const row = up(n, "tr");
    const rowFirst = row ? (row.childNodes ?? []).find((c) => c.tagName === "td" || c.tagName === "th") : null;
    const rowLabel = rowFirst ? safeLabel(text(rowFirst), searched) : "";
    const sameRow = rowLabel && !/remplac/i.test(rowLabel) && row && /\d[.,]\d{2}\s*€/.test(text(row));
    const handlers = (n.attrs ?? [])
      .filter((a) => /^on[a-z]+$/.test(a.name) || (a.name === "href" && /^javascript:/i.test(a.value)))
      .map((a) => ({ event: a.name === "href" ? "href:javascript" : a.name, functions: safeFunctions(a.value), endpoints: safeEndpoints(a.value) }));
    const form = up(n, "form");
    controls.push({
      index: controls.length + 1,
      designation: sameRow ? rowLabel : lastPriceRow,
      designationSource: sameRow ? "même ligne" : lastPriceRow ? "ligne de prix précédente" : "indéterminée",
      tag: n.tagName!,
      type,
      label,
      checkedDefault: type === "checkbox" || type === "radio" ? (n.attrs ?? []).some((a) => a.name === "checked") : null,
      disabled: (n.attrs ?? []).some((a) => a.name === "disabled"),
      hasId: Boolean(attr(n, "id")),
      nameShape: nameShape(nm),
      attrNames: [...new Set((n.attrs ?? []).map((a) => (a.name.startsWith("data-") ? a.name.replace(/\d{3,}/g, "#") : a.name)))].slice(0, 15),
      handlers,
      form: form ? { method: (attr(form, "method") ?? "GET").toUpperCase(), action: safeEndpoints(` ${attr(form, "action") ?? ""}`)[0] ?? null } : null,
    });
  }

  const allJs = scriptsJs.join("\n");
  const fnNames = new Set<string>();
  for (const m of allJs.matchAll(/function\s+([A-Za-z_$][\w$]{1,40})|([A-Za-z_$][\w$]{1,40})\s*=\s*function/g)) {
    const f = m[1] ?? m[2]!;
    if (/remplac|replace|temps|chiffr|duree|minute|mo[A-Z_]/i.test(f) && fnNames.size < MAX) fnNames.add(f);
  }
  const scripts = { count: scriptsJs.length, mentionsRemplac: /remplac/i.test(allJs), functions: [...fnNames], endpoints: safeEndpoints(allJs) };

  if (!controls.length) warnings.push("Aucun contrôle « Remplacer » dans la réponse de recherche : il peut n'apparaître qu'après sélection de la pièce (page détail / chiffrage).");
  if (controls.some((c) => !c.handlers.length && !c.form)) warnings.push("Contrôle sans gestionnaire ni formulaire visible : le calcul est piloté ailleurs (script global), non déterminable en statique.");
  if (controls.some((c) => c.designationSource !== "même ligne")) warnings.push("Rattachement carte ↔ contrôle non certain pour au moins un contrôle.");
  if (timeRows.some((t) => t.numericPresent && t.unit === "aucune unité affichée")) warnings.push("Valeur numérique sans unité dans une ligne de temps : minutes/heures non établies.");
  warnings.push("Aucune durée n'est extraite ni validée ; un temps de remplacement IXELLIO n'est pas assimilé à un TM constructeur.");
  return { controls, otherCheckboxes, remplacerTextOccurrences: remplacerText, scripts, timeRows, warnings };
}
