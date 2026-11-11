/**
 * Parseur pur des résultats « Recherche par référence » IXELLIO (PieceRecherche.html).
 *
 * Structure HTML réelle NON encore relevée : le parseur lit les tableaux à en-têtes
 * et rattache chaque colonne à un champ par son libellé. Rien n'est inféré :
 *  - prix HT/TTC seulement si l'en-tête le dit ; sinon basis = "unknown" ;
 *  - prix public seulement si l'en-tête dit « public » / « PVC » / « prix conseillé » ;
 *  - champ absent = null.
 * Chaque valeur porte sa provenance (libellé d'en-tête) et une confiance.
 */
import { decodeEntities, stripTags } from "./ixellio-parse";

export type Confidence = "header" | "structure" | "none";
export type Sourced<T> = { value: T; source: string; confidence: Confidence } | null;
export type PriceBasis = "HT" | "TTC" | "unknown";

export type IxellioPartPrice = {
  amount: number;
  currency: string | null;
  basis: PriceBasis;
  isPublic: boolean | null;
  source: string;
};

export type IxellioPart = {
  reference: Sourced<string>;
  exactMatch: boolean;
  designations: { value: string; source: string }[];
  family: Sourced<string>;
  brand: Sourced<string>;
  prices: IxellioPartPrice[];
  /** Liens de fiche relatifs au domaine IXELLIO (chemin + method seulement). */
  detailLinks: string[];
  /** Colonnes non reconnues : libellé → valeur (pour enrichissement futur). */
  extra: Record<string, string>;
};

export type IxellioPartsResult = {
  isLoginPage: boolean;
  noResult: boolean;
  parts: IxellioPart[];
  /** Diagnostic non sensible : en-têtes de tableaux détectés. */
  headers: string[][];
  tableCount: number;
};

const norm = (s: string) =>
  stripTags(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

export const normRef = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

type Col = "reference" | "designation" | "family" | "brand" | "price" | null;

export function classifyHeader(h: string): Col {
  const n = norm(h);
  if (!n) return null;
  if (/(prix|tarif|montant|p\.?u\b|pvc|€)/.test(n)) return "price";
  if (/^(ref|reference|n ?° ?piece|numero|code piece|ref\.? (constructeur|oe|piece))/.test(n) || n === "ref.") return "reference";
  if (/(designation|libelle|description|denomination|nom)/.test(n)) return "designation";
  if (/(famille|categorie|groupe|sous-famille|rubrique)/.test(n)) return "family";
  if (/(marque|fabricant|equipementier|constructeur)/.test(n)) return "brand";
  return null;
}

export function priceBasisFromHeader(h: string): PriceBasis {
  const n = norm(h);
  if (/\bttc\b/.test(n)) return "TTC";
  if (/\bht\b/.test(n)) return "HT";
  return "unknown";
}

export function isPublicFromHeader(h: string): boolean | null {
  const n = norm(h);
  if (/(public|pvc|prix conseille|prix catalogue)/.test(n)) return true;
  if (/(net|remise|achat|pa\b)/.test(n)) return false;
  return null;
}

/** "119,25 €" → 119.25 ; "1 234,50" → 1234.5 ; sinon null. */
export function parseAmount(raw: string): { amount: number; currency: string | null } | null {
  const t = stripTags(raw).replace(/\u00a0/g, " ");
  const m = /(-?\d{1,3}(?:[ .]\d{3})*(?:,\d{1,4})|-?\d+(?:[.,]\d{1,4})?)/.exec(t);
  if (!m) return null;
  let s = m[1]!.replace(/ /g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const amount = Number(s);
  if (!Number.isFinite(amount)) return null;
  const currency = /€|eur\b/i.test(t) ? "EUR" : null;
  return { amount, currency };
}

function cells(rowHtml: string): string[] {
  const out: string[] = [];
  const re = /<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowHtml))) out.push(m[2] ?? "");
  return out;
}

/** Ne garde qu'un chemin relatif IXELLIO + method (aucun autre paramètre, aucun hôte tiers). */
export function safeDetailLink(href: string): string | null {
  try {
    const u = new URL(decodeEntities(href), "https://www.ixellio.fr");
    if (u.hostname !== "www.ixellio.fr" || u.protocol !== "https:") return null;
    if (!/\.html$/i.test(u.pathname)) return null;
    const method = u.searchParams.get("method");
    return `${u.pathname}${method ? `?method=${method}` : ""}`;
  } catch {
    return null;
  }
}

export function parseIxellioParts(html: string, searched: string): IxellioPartsResult {
  const lower = html.toLowerCase();
  const isLoginPage = lower.includes("j_username") || lower.includes("j_spring_security_check");
  const target = normRef(searched);
  const parts: IxellioPart[] = [];
  const headers: string[][] = [];
  const tables = html.match(/<table\b[\s\S]*?<\/table>/gi) ?? [];

  for (const table of tables) {
    const rows = table.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
    if (rows.length < 2) continue;
    const head = cells(rows[0]!).map((c) => stripTags(c));
    const kinds = head.map(classifyHeader);
    if (!kinds.includes("reference") && !kinds.includes("price")) continue;
    headers.push(head);

    for (const row of rows.slice(1)) {
      const cs = cells(row);
      if (cs.length < 2) continue;
      const part: IxellioPart = {
        reference: null,
        exactMatch: false,
        designations: [],
        family: null,
        brand: null,
        prices: [],
        detailLinks: [],
        extra: {},
      };
      cs.forEach((raw, i) => {
        const label = head[i] ?? `col${i + 1}`;
        const val = stripTags(raw);
        if (!val) return;
        switch (kinds[i]) {
          case "reference":
            part.reference ??= { value: val, source: label, confidence: "header" };
            break;
          case "designation":
            part.designations.push({ value: val, source: label });
            break;
          case "family":
            part.family ??= { value: val, source: label, confidence: "header" };
            break;
          case "brand":
            part.brand ??= { value: val, source: label, confidence: "header" };
            break;
          case "price": {
            const a = parseAmount(raw);
            if (a)
              part.prices.push({
                ...a,
                basis: priceBasisFromHeader(label),
                isPublic: isPublicFromHeader(label),
                source: label,
              });
            break;
          }
          default:
            if (val.length <= 120) part.extra[label] = val;
        }
      });
      const links = row.match(/href\s*=\s*["']([^"']+)["']/gi) ?? [];
      for (const l of links) {
        const href = /["']([^"']+)["']/.exec(l)?.[1];
        const safe = href ? safeDetailLink(href) : null;
        if (safe && !part.detailLinks.includes(safe)) part.detailLinks.push(safe);
      }
      if (!part.reference && !part.prices.length && !part.designations.length) continue;
      part.exactMatch = Boolean(part.reference && normRef(part.reference.value) === target);
      parts.push(part);
    }
  }

  const noResult =
    !isLoginPage && parts.length === 0 && /(aucun(e)? (resultat|piece|reference)|no result)/.test(norm(html));
  return { isLoginPage, noResult, parts, headers, tableCount: tables.length };
}

/* ------------------------------------------------------------------ */
/* Instrumentation diagnostic NON SENSIBLE (manager) : formes seulement. */
/* Jamais : HTML brut, valeurs de champs, hidden, _csrf, cookies.        */
/* ------------------------------------------------------------------ */

export type FormShape = {
  action: string | null;
  httpMethod: string;
  fields: { name: string; type: string; options?: number }[];
};

export type StructureShape = {
  title: string | null;
  headings: string[];
  messages: string[];
  tables: { rows: number; cols: number; nested: boolean; headerRows: string[][] }[];
  repeatedBlocks: { cls: string; count: number }[];
  scriptEndpoints: string[];
  referencePresent: boolean;
  referenceOccurrences: number;
};

/** Libellé court et nettoyé : masque emails, téléphones, jetons, la référence cherchée. */
export function safeLabel(raw: string, searched = "", max = 40): string {
  let t = decodeEntities(stripTags(raw)).replace(/\s+/g, " ").trim();
  if (searched && searched.length >= 4) {
    const re = new RegExp(searched.split("").map((c) => c.replace(/[^A-Za-z0-9]/g, "")).join("[^A-Za-z0-9]?"), "gi");
    t = t.replace(re, "[réf]");
  }
  t = t
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/(?:\+33|0)\s?[1-9](?:[\s.-]?\d{2}){4}/g, "[tél]")
    .replace(/\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{6,}\b/g, "[code]");
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Chemin + paramètre method seulement ; jamais d'autres paramètres ni d'hôte tiers. */
export function safeActionPath(href: string | null | undefined, base = "https://www.ixellio.fr/PieceRecherche.html"): string | null {
  if (href == null) return null;
  try {
    const u = new URL(decodeEntities(href.trim()) || base, base);
    if (u.hostname !== "www.ixellio.fr") return "[hôte externe]";
    const method = u.searchParams.get("method");
    const safeMethod = method && /^[A-Za-z0-9_]{1,40}$/.test(method) ? method : null;
    return `${u.pathname}${safeMethod ? `?method=${safeMethod}` : ""}`;
  } catch {
    return null;
  }
}

const attr = (tag: string, name: string) =>
  new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(1).find((x) => x != null) ?? null;

export function inspectForms(html: string): FormShape[] {
  const out: FormShape[] = [];
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const open = m[1] ?? "";
    const body = m[2] ?? "";
    const fields: FormShape["fields"] = [];
    for (const f of body.matchAll(/<(input|textarea|button)\b([^>]*)>|<(select)\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
      const tagName = (f[1] ?? f[3]!).toLowerCase();
      const open = f[2] ?? f[4] ?? "";
      const name = attr(open, "name");
      if (!name) continue;
      const safeName = /^[A-Za-z0-9_.\-[\]]{1,60}$/.test(name) ? name : "[nom non standard]";
      const type = tagName === "input" ? (attr(open, "type") ?? "text").toLowerCase() : tagName;
      const field: FormShape["fields"][number] = { name: safeName, type };
      if (tagName === "select") field.options = (f[5]?.match(/<option\b/gi) ?? []).length;
      fields.push(field);
    }
    out.push({ action: safeActionPath(attr(open, "action") ?? ""), httpMethod: /^post$/i.test(attr(open, "method") ?? "") ? "POST" : "GET", fields });
  }
  return out;
}

/** Découpe les tableaux en gérant l'imbrication (profondeur). */
function splitTables(html: string): { html: string; nested: boolean }[] {
  const res: { html: string; nested: boolean }[] = [];
  const stack: number[] = [];
  const re = /<\/?table\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0][1] !== "/") stack.push(m.index);
    else if (stack.length) {
      const start = stack.pop()!;
      res.push({ html: html.slice(start, m.index + m[0].length), nested: stack.length > 0 });
    }
  }
  return res;
}

export function inspectStructure(html: string, searched: string): StructureShape {
  // Contenu des scripts retiré entièrement : jamais exposé dans les libellés.
  const clean = stripScripts(html);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const headings = [...html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)].slice(0, 5).map((h) => safeLabel(h[1]!, searched)).filter(Boolean);
  const messages = [...html.matchAll(/<(div|span|p|li)\b[^>]*class=["'][^"']*(error|erreur|alert|message|warning|info)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((x) => safeLabel(x[3]!, searched, 120))
    .filter(Boolean)
    .slice(0, 3);
  const tables = splitTables(clean).slice(0, 20).map(({ html: t, nested }) => {
    const inner = t.replace(/^<table\b[^>]*>/i, "").replace(/<\/table>$/i, "").replace(/<table\b[\s\S]*<\/table>/gi, "");
    const rows = inner.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
    const cellsOf = (r: string) => [...r.matchAll(/<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((c) => c[2] ?? "");
    const cols = Math.max(0, ...rows.map((r) => cellsOf(r).length));
    const headerRows = rows.slice(0, 2).map((r) => cellsOf(r).slice(0, 12).map((c) => safeLabel(c, searched, 30)));
    return { rows: rows.length, cols, nested, headerRows };
  });
  const counts = new Map<string, number>();
  for (const c of html.matchAll(/<(?:div|li|tr)\b[^>]*class=["']([^"']+)["']/gi))
    for (const cls of c[1]!.split(/\s+/))
      if (/(result|piece|ligne|row|article|produit|item)/i.test(cls) && /^[A-Za-z0-9_-]{1,40}$/.test(cls)) counts.set(cls, (counts.get(cls) ?? 0) + 1);
  const repeatedBlocks = [...counts].filter(([, n]) => n >= 2).map(([cls, count]) => ({ cls, count })).slice(0, 10);
  const endpoints = new Set<string>();
  for (const s of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const u of s[1]!.matchAll(/["'`]([^"'`\s]*?\.(?:html|do|json)(?:\?[^"'`\s]*)?)["'`]/gi)) {
      const p = safeActionPath(u[1]);
      if (p && p !== "[hôte externe]") endpoints.add(p);
    }
    for (const u of s[1]!.matchAll(/method=([A-Za-z0-9_]{1,40})/g)) endpoints.add(`method=${u[1]}`);
  }
  const target = normRef(searched);
  const flat = normRef(stripTags(clean));
  const occ = target.length >= 4 ? flat.split(target).length - 1 : 0;
  return {
    title: title ? safeLabel(title, searched, 80) : null,
    headings,
    messages,
    tables,
    repeatedBlocks,
    scriptEndpoints: [...endpoints].slice(0, 20),
    referencePresent: occ > 0,
    referenceOccurrences: occ,
  };
}

/** Retire scripts/styles/commentaires (contenu compris). */
export function stripScripts(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

export type PageFormHints = {
  formOpen: number;
  formClose: number;
  /** Champs hors <form> : nom/type seulement. */
  looseFields: { name: string; type: string }[];
  /** Soumissions repérées dans les scripts/attributs : chemin + method seulement. */
  submitTargets: string[];
};

/** Indices du vrai formulaire quand aucun <form> complet n'est repéré (page GET). */
export function inspectPageFormHints(html: string): PageFormHints {
  const noForms = html.replace(/<form\b[\s\S]*?<\/form>/gi, " ");
  const loose: PageFormHints["looseFields"] = [];
  for (const f of stripScripts(noForms).matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
    const name = attr(f[2] ?? "", "name");
    if (!name || loose.length >= 30) continue;
    loose.push({
      name: /^[A-Za-z0-9_.\-[\]]{1,60}$/.test(name) ? name : "[nom non standard]",
      type: f[1]!.toLowerCase() === "input" ? (attr(f[2] ?? "", "type") ?? "text").toLowerCase() : f[1]!.toLowerCase(),
    });
  }
  const targets = new Set<string>();
  const sources = [
    ...[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1] ?? ""),
    ...[...html.matchAll(/\son(?:click|submit|change)\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1] ?? ""),
  ];
  for (const src of sources)
    for (const u of src.matchAll(/["'`]([^"'`\s]*?\.html(?:\?[^"'`\s]*)?)["'`]/gi)) {
      const p = safeActionPath(u[1]);
      if (p && p !== "[hôte externe]") targets.add(p);
    }
  return {
    formOpen: (html.match(/<form\b/gi) ?? []).length,
    formClose: (html.match(/<\/form>/gi) ?? []).length,
    looseFields: loose,
    submitTargets: [...targets].slice(0, 20),
  };
}

export type PrixToolShape = { argCount: number; argKinds: string[]; objectKeys: string[] };
export type ReferenceAnchor = { depth: number; rows: number; cols: number; rowLabels: string[]; prixToolCalls: number };
export type PriceCandidate = { label: string; amount: number | null; basis: PriceBasis; status: "explicite" | "inconnu" };
export type TargetedDiag = {
  referenceAnchors: ReferenceAnchor[];
  prixTool: { count: number; samples: PrixToolShape[] };
  priceCandidates: PriceCandidate[];
};

function argKind(a: string): string {
  const t = a.trim();
  if (!t) return "vide";
  if (/^-?\d+(?:[.,]\d+)?$/.test(t)) return "nombre";
  if (/^["'`]/.test(t)) return "texte";
  if (/^(true|false)$/.test(t)) return "booléen";
  if (/^null|undefined$/.test(t)) return "null";
  if (t.startsWith("{")) return "objet";
  if (t.startsWith("[")) return "tableau";
  return "expression";
}

/** Découpe les arguments au premier niveau (sans valeurs exposées). */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0, q: string | null = null, cur = "";
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === "`") { q = c; cur += c; continue; }
    if ("([{".includes(c)) depth++;
    if (")]}".includes(c)) { if (depth === 0) break; depth--; }
    if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim() || out.length) out.push(cur);
  return out;
}

/** Diagnostic ciblé « Référence : » / createPrixStatusTool / « Prix » — formes, jamais de contenu de script. */
export function inspectTargeted(html: string, searched: string): TargetedDiag {
  const tables = splitTablesWithDepth(html);
  const referenceAnchors: ReferenceAnchor[] = [];
  for (const t of tables) {
    if (referenceAnchors.length >= 3) break;
    const own = ownContent(t.html);
    if (!/r[ée]f[ée]rence\s*:/i.test(stripTags(stripScripts(own)))) continue;
    const rows = own.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
    const cellsOf = (r: string) => [...r.matchAll(/<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((c) => c[2] ?? "");
    referenceAnchors.push({
      depth: t.depth,
      rows: rows.length,
      cols: Math.max(0, ...rows.map((r) => cellsOf(r).length)),
      rowLabels: rows.slice(0, 10).map((r) => safeLabel(stripScripts(cellsOf(r)[0] ?? ""), searched, 30)),
      prixToolCalls: (own.match(/createPrixStatusTool\s*\(/g) ?? []).length,
    });
  }
  const calls = [...html.matchAll(/createPrixStatusTool\s*\(([\s\S]{0,600})/g)];
  const samples = calls.slice(0, 3).map((m) => {
    const args = splitArgs(m[1] ?? "");
    const keys = new Set<string>();
    for (const a of args.filter((x) => x.trim().startsWith("{")))
      for (const k of a.matchAll(/["']?([A-Za-z_][A-Za-z0-9_]{0,30})["']?\s*:/g)) keys.add(k[1]!);
    return { argCount: args.length, argKinds: args.map(argKind), objectKeys: [...keys].slice(0, 20) };
  });
  const text = decodeEntities(stripTags(stripScripts(html))).replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  const priceCandidates: PriceCandidate[] = [];
  for (const m of text.matchAll(/\b(prix[^:;|\d€]{0,30})\s*:?\s*(-?\d{1,3}(?:[ .]\d{3})*,\d{2}|-?\d+[.,]\d{2})?\s*(€|eur\b)?/gi)) {
    if (priceCandidates.length >= 10) break;
    const label = safeLabel(m[1]!, searched, 40);
    const a = m[2] ? parseAmount(`${m[2]} ${m[3] ?? ""}`) : null;
    priceCandidates.push({ label, amount: a?.amount ?? null, basis: priceBasisFromHeader(label), status: a ? "explicite" : "inconnu" });
  }
  return { referenceAnchors, prixTool: { count: calls.length, samples }, priceCandidates };
}

function splitTablesWithDepth(html: string): { html: string; depth: number }[] {
  const res: { html: string; depth: number }[] = [];
  const stack: number[] = [];
  for (const m of html.matchAll(/<\/?table\b[^>]*>/gi)) {
    if (m[0][1] !== "/") stack.push(m.index!);
    else if (stack.length) {
      const start = stack.pop()!;
      res.push({ html: html.slice(start, m.index! + m[0].length), depth: stack.length });
    }
  }
  // Les plus internes d'abord (ordre de fermeture) : les ancres ciblent la table la plus proche.
  return res;
}

/** Contenu propre d'une table, sans les tables imbriquées. */
function ownContent(table: string): string {
  let inner = table.replace(/^<table\b[^>]*>/i, "").replace(/<\/table>$/i, "");
  let prev = "";
  while (prev !== inner) { prev = inner; inner = inner.replace(/<table\b(?:(?!<table\b)[\s\S])*?<\/table>/gi, " "); }
  return inner;
}
