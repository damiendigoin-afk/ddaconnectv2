/**
 * Groupement des résultats exacts IXELLIO (diagnostic manager, lecture seule, aucun effet métier).
 * DOM parse5. Un résultat = une ligne « désignation | montant € » et UNE ancre « Référence : » dont
 * l'ancêtre commun le plus proche ne contient aucun autre montant ni aucune autre ancre (exclusivité
 * structurelle). Jamais de rapprochement par égalité de référence ni par proximité textuelle globale,
 * jamais de déduplication par numéro ou montant. Base HT/TTC et catégorie tarifaire toujours inconnues :
 * la conversion en devis reste bloquée.
 */
import { parse } from "parse5";

type Node = { nodeName: string; tagName?: string; value?: string; childNodes?: Node[]; parentNode?: Node | null };

export type IxellioResult = {
  index: number;
  category: string | null;
  designation: string;
  reference: string;
  family: string | null;
  priceDisplayed: string;
  amount: number;
  basis: "inconnu";
  tariffCategory: "inconnu";
  source: "IXELLIO";
  grouping: "structure exclusive";
};

export type IxellioGrouping = {
  /** Nombre annoncé par la page (« parmi les N résultat(s) exact(s) »), null si absent. */
  announced: number | null;
  results: IxellioResult[];
  /** Lignes montant non groupables : candidats non validés. */
  ungrouped: { designation: string; priceDisplayed: string; reason: string }[];
  confidence: "haute" | "partielle" | "refusée";
  confidenceReason: string;
  quoteConversion: "bloquée";
  quoteConversionReason: string;
};

const SKIP = new Set(["script", "style", "template", "noscript", "#comment"]);
const AMOUNT = /(\d{1,3}(?:[ .\u00a0\u202f]\d{3})*[.,]\d{2}|\d+[.,]\d{2})\s*(?:€|EUR\b)/i;
const REF = /r[ée]f[ée]rence\s*:\s*([A-Z0-9][A-Z0-9 .\-/]{2,30}?)(?=\s*(?:\||famille|$))/i;
const clean = (s: string) => s.replace(/[\s\u00a0\u202f]+/g, " ").trim();

function text(n: Node): string {
  if (SKIP.has(n.nodeName)) return "";
  if (n.nodeName === "#text") return n.value ?? "";
  return (n.childNodes ?? []).map(text).join(" ");
}
const cellsOf = (tr: Node) => (tr.childNodes ?? []).filter((c) => c.tagName === "td" || c.tagName === "th");
const ancestors = (n: Node) => { const a: Node[] = []; for (let p: Node | null | undefined = n; p; p = p.parentNode) a.push(p); return a; };
const contains = (outer: Node, inner: Node) => ancestors(inner).includes(outer);
function nca(a: Node, b: Node): Node | null {
  const set = new Set(ancestors(a));
  for (let p: Node | null | undefined = b; p; p = p.parentNode) if (set.has(p)) return p;
  return null;
}
function toAmount(raw: string): number | null {
  let s = raw.replace(/[\s\u00a0\u202f]/g, "");
  s = /,\d{2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function groupIxellioResults(html: string): IxellioGrouping {
  const doc = parse(html) as unknown as Node;
  const rows: Node[] = [];
  const tables: Node[] = [];
  (function walk(n: Node) {
    if (SKIP.has(n.nodeName)) return;
    if (n.tagName === "tr") rows.push(n);
    if (n.tagName === "table") tables.push(n);
    for (const c of n.childNodes ?? []) walk(c);
  })(doc);
  const ownText = (t: Node): string => {
    const rec = (n: Node): string =>
      n !== t && n.tagName === "table" ? "" : SKIP.has(n.nodeName) ? "" : n.nodeName === "#text" ? n.value ?? "" : (n.childNodes ?? []).map(rec).join(" ");
    return clean(rec(t));
  };

  const m = clean(text(doc)).match(/parmi\s+les\s+(\d+)\s+r[ée]sultat\(?s?\)?\s+exact/i);
  const announced = m ? Number(m[1]) : null;

  // Lignes prix : 2 cellules feuilles, la 1re sans montant, la 2e = montant seul.
  const priceRows = rows.flatMap((tr) => {
    const c = cellsOf(tr);
    if (c.length < 2 || c.some((x) => x.childNodes?.some((k) => k.tagName === "table"))) return [];
    const label = clean(text(c[0]!));
    const last = clean(text(c[c.length - 1]!));
    const am = last.match(AMOUNT);
    if (!label || AMOUNT.test(label) || !am || /r[ée]f[ée]rence\s*:/i.test(label)) return [];
    const amount = toAmount(am[1]!);
    return amount == null ? [] : [{ tr, designation: label.slice(0, 80), priceDisplayed: last.slice(0, 30), amount }];
  });
  const anchors = tables
    .filter((t) => !tables.some((o) => o !== t && contains(t, o) && REF.test(ownText(o))))
    .flatMap((t) => {
      const own = ownText(t);
      const r = own.match(REF);
      if (!r) return [];
      const fam = own.match(/famille\s*:\s*([^|]{1,60})/i);
      return [{ table: t, reference: clean(r[1]!).toUpperCase(), family: fam ? clean(fam[1]!) : null }];
    });

  const results: IxellioResult[] = [];
  const ungrouped: IxellioGrouping["ungrouped"] = [];
  const usedAnchors = new Set<number>();
  for (const p of priceRows) {
    // Ancre dont l'ancêtre commun est exclusif (1 ligne prix, 1 ancre).
    const fits = anchors.map((a, i) => ({ a, i, root: nca(p.tr, a.table) })).filter(({ root }) =>
      root && priceRows.filter((q) => contains(root, q.tr)).length === 1 && anchors.filter((x) => contains(root, x.table)).length === 1);
    if (fits.length !== 1 || usedAnchors.has(fits[0]!.i)) {
      ungrouped.push({ designation: p.designation, priceDisplayed: p.priceDisplayed, reason: fits.length ? "ancre déjà utilisée" : "aucun groupe exclusif montant + Référence" });
      continue;
    }
    const { a, i, root } = fits[0]!;
    usedAnchors.add(i);
    // Catégorie : texte propre d'une autre table du groupe, ni prix ni Référence, court.
    const priceTable = ancestors(p.tr).find((x) => x.tagName === "table");
    const cat = tables.find((t) => contains(root!, t) && t !== a.table && t !== priceTable && !contains(t, p.tr) && !contains(t, a.table)
      && ownText(t) && ownText(t).length <= 60 && !AMOUNT.test(ownText(t)));
    results.push({
      index: results.length + 1, category: cat ? ownText(cat) : null, designation: p.designation,
      reference: a.reference, family: a.family, priceDisplayed: p.priceDisplayed, amount: p.amount,
      basis: "inconnu", tariffCategory: "inconnu", source: "IXELLIO", grouping: "structure exclusive",
    });
  }

  let confidence: IxellioGrouping["confidence"];
  let confidenceReason: string;
  if (!results.length) { confidence = "refusée"; confidenceReason = "Aucun groupe montant + Référence exclusif : candidats non validés."; }
  else if (ungrouped.length || announced == null || announced !== results.length) {
    confidence = "partielle";
    confidenceReason = `${results.length} groupé(s), ${ungrouped.length} non groupé(s), page annonce ${announced ?? "?"} résultat(s).`;
  } else { confidence = "haute"; confidenceReason = `Nombre groupé = nombre annoncé par la page (${announced}).`; }

  return {
    announced, results, ungrouped, confidence, confidenceReason,
    quoteConversion: "bloquée",
    quoteConversionReason: "Base HT/TTC et catégorie tarifaire (public/achat) non indiquées par la page.",
  };
}
