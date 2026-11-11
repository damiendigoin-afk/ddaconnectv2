/**
 * Inventaire diagnostic des montants en € visibles dans la réponse IXELLIO (manager, lecture seule).
 * Arbre DOM parse5 ; scripts/styles/commentaires/templates ignorés. Aucune base HT/TTC ni prix public
 * n'est déduite : un montant n'est rattaché à une pièce que s'il est dans le même tableau qu'une ancre
 * « Référence : » ; sinon association « non vérifiée ».
 */
import { parse } from "parse5";

import { safeLabel } from "./ixellio-parts-parse";

type Node = {
  nodeName: string;
  tagName?: string;
  value?: string;
  childNodes?: Node[];
  content?: Node;
  parentNode?: Node | null;
};

export type EuroAmount = {
  amount: number;
  /** Texte court de la même cellule, montant retiré, masqué. */
  cellText: string;
  /** Première cellule de la même ligne si différente, masquée. */
  rowLabel: string | null;
  tableIndex: number | null;
  tableDepth: number;
  cellIndex: number | null;
  /** 0 = même tableau que « Référence : » ; n = n niveaux au-dessus ; null = aucun. */
  referenceLevelsUp: number | null;
  association: "même tableau que Référence" | "non vérifiée";
};

export type CatalogueCandidate = {
  label: string;
  amount: number;
  occurrences: number;
  basis: "inconnu";
  isPublic: "inconnu";
  isPurchase: "inconnu";
  /** Ancêtre commun le plus proche avec une ancre « Référence : » (preuve diagnostic uniquement). */
  commonAncestor: { tableIndex: number; candidatesInside: number; referenceAnchorsInside: number } | null;
  association: "non vérifiée";
};

export type EuroInventory = {
  total: number;
  distinctAmounts: number;
  items: EuroAmount[];
  /** Lignes libellé + montant de la même ligne : CANDIDATS NON VALIDÉS, jamais rattachés à la référence. */
  candidates: CatalogueCandidate[];
};

const SKIP = new Set(["script", "style", "template", "noscript", "#comment"]);
const AMOUNT = /(-?\d{1,3}(?:[ .\u00a0\u202f]\d{3})*[.,]\d{2}|-?\d+[.,]\d{2})\s*(?:€|EUR\b)|(?:€|EUR)\s*(-?\d+(?:[.,]\d{2}))/gi;

function text(n: Node): string {
  if (SKIP.has(n.nodeName)) return "";
  if (n.nodeName === "#text") return n.value ?? "";
  return (n.childNodes ?? []).map(text).join(" ");
}

const up = (n: Node, tag: string): Node | null => {
  for (let p = n.parentNode; p; p = p.parentNode) if (p.tagName === tag) return p;
  return null;
};

function toAmount(raw: string): number | null {
  let s = raw.replace(/[\s\u00a0\u202f]/g, "");
  if (/,\d{2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function inventoryEuroAmounts(html: string, searched: string, max = 30): EuroInventory {
  const doc = parse(html) as unknown as Node;
  const tables: Node[] = [];
  const texts: Node[] = [];
  (function walk(n: Node) {
    if (SKIP.has(n.nodeName)) return;
    if (n.tagName === "table") tables.push(n);
    if (n.nodeName === "#text") texts.push(n);
    for (const c of n.childNodes ?? []) walk(c);
  })(doc);

  /** Texte propre de la table (sans tables imbriquées). */
  const ownText = (t: Node): string => {
    const rec = (n: Node): string =>
      n !== t && n.tagName === "table" ? "" : n.nodeName === "#text" ? n.value ?? "" : SKIP.has(n.nodeName) ? "" : (n.childNodes ?? []).map(rec).join(" ");
    return rec(t);
  };
  const refTables = new Set(tables.filter((t) => /r[ée]f[ée]rence\s*:/i.test(ownText(t))));

  const items: EuroAmount[] = [];
  const rawCand: { label: string; amount: number; table: Node | null }[] = [];
  let total = 0;
  const distinct = new Set<number>();
  for (const tn of texts) {
    const v = tn.value ?? "";
    for (const m of v.matchAll(AMOUNT)) {
      const amount = toAmount(m[1] ?? m[2] ?? "");
      if (amount == null) continue;
      total++;
      distinct.add(amount);
      if (items.length >= max) continue;
      const cell = up(tn, "td") ?? up(tn, "th");
      const row = cell ? up(cell, "tr") : null;
      const table = up(tn, "table");
      let depth = 0;
      for (let t = table; t; t = up(t, "table")) depth++;
      let levels: number | null = null;
      for (let t = table, i = 0; t; t = up(t, "table"), i++) if (refTables.has(t)) { levels = i; break; }
      const cells = row ? (row.childNodes ?? []).filter((c) => c.tagName === "td" || c.tagName === "th") : [];
      const cellText = safeLabel((cell ? text(cell) : v).replace(AMOUNT, " "), searched, 40);
      const first = cells[0] && cells[0] !== cell ? safeLabel(text(cells[0]), searched, 40) : null;
      if (first) rawCand.push({ label: first, amount, table });
      items.push({
        amount,
        cellText,
        rowLabel: first || null,
        tableIndex: table ? tables.indexOf(table) + 1 : null,
        tableDepth: depth,
        cellIndex: cell ? cells.indexOf(cell) : null,
        referenceLevelsUp: levels,
        association: levels === 0 ? "même tableau que Référence" : "non vérifiée",
      });
    }
  }
  // Ancêtre commun : plus proche table englobant le montant ET une table « Référence : ».
  const contains = (outer: Node, inner: Node) => {
    for (let p: Node | null | undefined = inner; p; p = p.parentNode) if (p === outer) return true;
    return false;
  };
  const candTables = rawCand.map((c) => c.table);
  const byKey = new Map<string, CatalogueCandidate>();
  for (const c of rawCand) {
    let common: CatalogueCandidate["commonAncestor"] = null;
    for (let t = c.table; t; t = up(t, "table")) {
      const anchors = [...refTables].filter((r) => contains(t!, r)).length;
      if (anchors) {
        common = {
          tableIndex: tables.indexOf(t) + 1,
          candidatesInside: candTables.filter((x) => x && contains(t!, x)).length,
          referenceAnchorsInside: anchors,
        };
        break;
      }
    }
    const key = `${c.label}|${c.amount}`;
    const prev = byKey.get(key);
    if (prev) prev.occurrences++;
    else
      byKey.set(key, {
        label: c.label, amount: c.amount, occurrences: 1,
        basis: "inconnu", isPublic: "inconnu", isPurchase: "inconnu",
        commonAncestor: common, association: "non vérifiée",
      });
  }
  return { total, distinctAmounts: distinct.size, items, candidates: [...byKey.values()].slice(0, 20) };
}
