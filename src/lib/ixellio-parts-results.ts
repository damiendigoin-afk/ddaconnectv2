/**
 * Groupement des résultats exacts IXELLIO (diagnostic manager, lecture seule, aucun effet métier).
 * DOM parse5. Un résultat = une ligne « désignation | montant € » et UNE ancre « Référence : » dont
 * l'ancêtre commun le plus proche ne contient aucun autre montant ni aucune autre ancre (exclusivité
 * structurelle). Jamais de rapprochement par égalité de référence ni par proximité textuelle globale,
 * jamais de déduplication par numéro ou montant. Qualification tarifaire : IXELLIO_TARIFF (prix public constructeur HT,
 * déclaration du gérant). La conversion en devis reste bloquée (groupement réel à valider).
 */
import { parse } from "parse5";

import { safeLabel, type IxellioPart } from "./ixellio-parts-parse";
import { IXELLIO_TARIFF } from "./ixellio-tariff";

type Node = { nodeName: string; tagName?: string; value?: string; childNodes?: Node[]; parentNode?: Node | null };

export type IxellioResult = {
  index: number;
  category: string | null;
  /** « vérifiée » seulement si la table immédiatement avant la table prix porte une seule cellule utile. */
  categoryConfidence: "vérifiée" | "non vérifiée";
  designation: string;
  reference: string;
  family: string | null;
  priceDisplayed: string;
  amount: number;
  basis: "HT";
  tariffCategory: "public_constructeur";
  isPublic: true;
  isPurchase: false;
  qualificationSource: string;
  source: "IXELLIO";
  grouping: "structure exclusive";
};

export type CategoryProbe = {
  tableIndex: number; label: string; rows: number; cells: number;
  /** Cellules portant un libellé textuel significatif (hors tables imbriquées, scripts, espaces, images). */
  filledCells: number;
  /** Lignes propres contenant au moins une cellule renseignée. */
  filledRows: number;
  depth: number; inExclusiveBlock: boolean; verdict: string;
};

export type IxellioGrouping = {
  /** G. Diagnostic catégorie : 3 tables précédant chaque montant (libellés masqués). */
  categoryProbes: { designation: string; probes: CategoryProbe[] }[];
  /** Nombre annoncé par la page (« parmi les N résultat(s) exact(s) »), null si absent. */
  announced: number | null;
  results: IxellioResult[];
  /** Lignes montant non groupables : candidats non validés. */
  ungrouped: { designation: string; priceDisplayed: string; reason: string }[];
  /** Groupement référence + prix (structure exclusive + nombre annoncé). */
  groupingConfidence: "haute" | "partielle" | "refusée";
  categoriesVerified: number;
  /** Global : « haute » seulement si groupement haute ET toutes les catégories vérifiées. */
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

export function groupIxellioResults(html: string, searched = ""): IxellioGrouping {
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

  // Catégorie : ordre réel des tables (ouverture, comme inspectStructure). On remonte depuis la table
  // du montant en ignorant ses ancêtres et les tables vides ; la PREMIÈRE table rencontrée décide :
  // elle doit porter exactement UNE cellule renseignée (libellé significatif, tables imbriquées,
  // scripts, espaces/NBSP, images/icônes exclus) sur une seule ligne propre, sans montant ni Référence.
  // « Hors bloc » est attendu (en-tête frère du bloc exclusif) et n'est pas un motif de rejet.
  // Sinon null. Ne traverse jamais une table de montant ou de Référence (frontière d'un autre résultat),
  // ni une table concurrente intercalée (elle décide et est rejetée).
  const ownRows = (t: Node): Node[] => rows.filter((r) => ancestors(r).find((x) => x !== r && x.tagName === "table") === t);
  const cellText = (c: Node): string => {
    const rec = (n: Node): string =>
      n.tagName === "table" || SKIP.has(n.nodeName) ? "" : n.nodeName === "#text" ? n.value ?? "" : (n.childNodes ?? []).map(rec).join(" ");
    return clean(rec(c));
  };
  const meaningful = (s: string) => /[\p{L}\p{N}]/u.test(s);
  const norm = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Libellé portant la référence cherchée ou un code de type référence (≥ 7 car. dont ≥ 4 chiffres) : jamais une catégorie.
  const refLike = (l: string) => (!!searched && norm(searched).length >= 5 && norm(l).includes(norm(searched)))
    || /\b(?=[A-Z0-9]*\d[A-Z0-9]*\d[A-Z0-9]*\d[A-Z0-9]*\d)[A-Z0-9]{7,}\b/i.test(l);
  const refSet = new Set(anchors.map((x) => x.table));
  const priceTables = new Set(priceRows.map((q) => ancestors(q.tr).find((x) => x !== q.tr && x.tagName === "table")!));
  const categoryFor = (tr: Node, root: Node | null) => {
    const priceTable = ancestors(tr).find((x) => x !== tr && x.tagName === "table")!;
    const idx = tables.indexOf(priceTable);
    const seen: CategoryProbe[] = [];
    let chosen: string | null = null;
    let decided = false;
    for (let i = idx - 1; i >= 0 && seen.length < 3; i--) {
      const t = tables[i]!;
      if (contains(t, priceTable)) continue; // ancêtre du montant
      const own = ownRows(t);
      const cells = own.reduce((n, r) => n + cellsOf(r).length, 0);
      const filled = own.map((r) => cellsOf(r).map(cellText).filter(meaningful)).filter((l) => l.length);
      const filledCells = filled.reduce((n, l) => n + l.length, 0);
      const txt = ownText(t);
      const probe: CategoryProbe = {
        tableIndex: i + 1, label: safeLabel(txt, searched, 40), rows: own.length, cells, filledCells, filledRows: filled.length,
        depth: ancestors(t).filter((x) => x !== t && x.tagName === "table").length + 1,
        inExclusiveBlock: !!root && contains(root, t), verdict: "",
      };
      seen.push(probe);
      if (decided) { probe.verdict = "non examinée (décision prise)"; continue; }
      if (!filledCells && !meaningful(txt)) { probe.verdict = "ignorée : aucune cellule renseignée"; continue; }
      decided = true;
      const label = filled[0]?.[0] ?? "";
      if (refSet.has(t) || priceTables.has(t)) probe.verdict = "rejet : frontière (Référence/montant)";
      else if (AMOUNT.test(txt)) probe.verdict = "rejet : contient un montant";
      else if (/r[ée]f[ée]rence\s*:/i.test(txt)) probe.verdict = "rejet : contient « Référence : »";
      else if (refLike(label)) probe.verdict = "rejet : contient une référence (en-tête de page ou autre résultat)";
      else if (filledCells === 0) probe.verdict = "rejet : texte hors cellule (structure inattendue)";
      else if (filled.length > 1) probe.verdict = `rejet : ${filled.length} lignes renseignées (prudence)`;
      else if (filledCells > 1) probe.verdict = `rejet : ${filledCells} cellules renseignées (libellés concurrents)`;
      else if (label.length > 60) probe.verdict = "rejet : trop long";
      else { probe.verdict = "retenue (1 cellule utile)"; chosen = label; }
    }
    return { category: chosen, confidence: (chosen ? "vérifiée" : "non vérifiée") as "vérifiée" | "non vérifiée", probes: seen };
  };
  const probes: IxellioGrouping["categoryProbes"] = [];

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
    const cat = categoryFor(p.tr, root);
    probes.push({ designation: safeLabel(p.designation, searched, 40), probes: cat.probes });
    results.push({
      index: results.length + 1, category: cat.category, categoryConfidence: cat.confidence, designation: p.designation,
      reference: a.reference, family: a.family, priceDisplayed: p.priceDisplayed, amount: p.amount,
      ...IXELLIO_TARIFF, source: "IXELLIO", grouping: "structure exclusive",
    });
  }

  let groupingConfidence: IxellioGrouping["groupingConfidence"];
  let confidenceReason: string;
  if (!results.length) { groupingConfidence = "refusée"; confidenceReason = "Aucun groupe montant + Référence exclusif : candidats non validés."; }
  else if (ungrouped.length || announced == null || announced !== results.length) {
    groupingConfidence = "partielle";
    confidenceReason = `${results.length} groupé(s), ${ungrouped.length} non groupé(s), page annonce ${announced ?? "?"} résultat(s).`;
  } else { groupingConfidence = "haute"; confidenceReason = `Nombre groupé = nombre annoncé par la page (${announced}).`; }
  const categoriesVerified = results.filter((r) => r.categoryConfidence === "vérifiée").length;
  const confidence: IxellioGrouping["confidence"] =
    groupingConfidence === "haute" && categoriesVerified < results.length ? "partielle" : groupingConfidence;
  if (categoriesVerified < results.length) confidenceReason += ` Catégorie non vérifiée pour ${results.length - categoriesVerified} résultat(s).`;

  return {
    announced, results, ungrouped, categoryProbes: probes, groupingConfidence, categoriesVerified, confidence, confidenceReason,
    quoteConversion: "bloquée",
    quoteConversionReason: "Groupement référence ↔ désignation ↔ prix à valider sur la vraie page ; décision de workflow en attente (un prix public constructeur n'est pas un prix d'achat et ne remplit jamais le PA).",
  };
}

/**
 * Lignes « parts » issues du groupement, UNIQUEMENT si : groupement haute, chaque référence = référence
 * cherchée, nombre = annoncé, aucune ligne non groupée. Catégorie absente n'annule pas un prix/réf validé.
 * Prix = public constructeur HT (déclaration gérant), jamais prix d'achat. Sinon null.
 */
export function groupingToParts(g: IxellioGrouping, searched: string): IxellioPart[] | null {
  const n = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (g.groupingConfidence !== "haute" || g.ungrouped.length || g.announced !== g.results.length || !g.results.length) return null;
  if (!searched || g.results.some((r) => n(r.reference) !== n(searched))) return null;
  return g.results.map((r) => ({
    reference: { value: r.reference, source: "Référence : (bloc résultat)", confidence: "structure" },
    exactMatch: true,
    designations: [{ value: r.designation, source: "ligne montant" }],
    family: r.family ? { value: r.family, source: "Famille :", confidence: "structure" } : null,
    brand: null,
    prices: [{ amount: r.amount, currency: "€", basis: "HT", isPublic: true, source: IXELLIO_TARIFF.qualificationSource }],
    detailLinks: [],
    extra: { Catégorie: r.categoryConfidence === "vérifiée" && r.category ? r.category : "non vérifiée" },
  }));
}
