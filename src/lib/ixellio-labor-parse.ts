/**
 * IXELLIO — temps barémés constructeur (TM) : inspection PURE, lecture seule, diagnostic manager.
 * parse5, robuste aux tableaux imbriqués. Ne renvoie jamais : HTML brut, valeurs de champs, jetons,
 * cookies, identifiants, valeurs de paramètres d'URL. Aucun TM n'est produit sans tableau explicite
 * (code/libellé d'opération + colonne de temps avec unité déclarée). Les rubriques de chiffrage
 * carrosserie (Redressage/Réparation/Peinture | Temps) ne sont jamais des temps barémés mécaniques.
 */
import { parse } from "parse5";
import { safeLabel } from "./ixellio-parts-parse";

type Node = { nodeName: string; tagName?: string; value?: string; attrs?: { name: string; value: string }[]; childNodes?: Node[] };

export type LaborStatus = "no_result" | "needs_vehicle" | "needs_operation" | "structure_unknown";
export type LaborGrade = "T1" | "T2" | "T3";

export type IxellioLaborTime = {
  operationCode: string | null;
  operationLabel: string;
  /** VIN ou identifiant de version, seulement si la page l'affiche explicitement pour ce temps. */
  vehicleMatch: { kind: "vin" | "version"; value: string } | null;
  /** Durée exacte en heures, convertie seulement depuis une unité déclarée (h ou min). */
  durationHours: number;
  timeUnitOriginal: "h" | "min";
  labourGrade: LaborGrade | null;
  sourceMethod: string;
  confidence: "explicite";
};

export type MenuCategory = "temps_bareme" | "forfaits" | "chiffrage" | "pieces" | "vehicule" | "documentation" | "autre";
export type MenuEntry = {
  label: string;
  path: string;
  httpMethod: "GET" | "POST";
  paramNames: string[];
  via: "lien" | "formulaire" | "script";
  category: MenuCategory;
  needsVehicle: boolean;
  needsOperation: boolean;
};
export type MenuForm = { path: string; httpMethod: "GET" | "POST"; fields: { name: string; type: string }[] };
export type MenuInspection = {
  isLoginPage: boolean;
  title: string;
  entries: MenuEntry[];
  forms: MenuForm[];
  /** Mentions d'accès limité (non souscrit, droit, abonnement), libellés masqués. */
  limitations: string[];
  laborCandidates: number;
};

const SKIP = new Set(["script", "style", "template", "noscript", "#comment"]);
const HIDE_PARAM = /csrf|token|jsession|session|sid|auth|pass|pwd|key|secret|hash|sign/i;
const attr = (n: Node, k: string) => n.attrs?.find((a) => a.name === k)?.value ?? "";
const clean = (s: string) => s.replace(/[\s\u00a0\u202f]+/g, " ").trim();
function text(n: Node): string {
  if (SKIP.has(n.nodeName)) return "";
  if (n.nodeName === "#text") return n.value ?? "";
  return (n.childNodes ?? []).map(text).join(" ");
}
function walk(n: Node, f: (n: Node) => void) {
  f(n);
  if (n.nodeName === "script") return;
  for (const c of n.childNodes ?? []) walk(c, f);
}

/** Chemin interne nettoyé : chemin + ?method=X ; autres paramètres = NOMS seulement. null si externe/JS/mailto. */
export function sanitizeInternalUrl(raw: string): { path: string; paramNames: string[] } | null {
  const r = raw.trim();
  if (!r || /^(javascript|mailto|tel|data):/i.test(r) || r.startsWith("#")) return null;
  let u: URL;
  try { u = new URL(r, "https://www.ixellio.fr/"); } catch { return null; }
  if (!/(^|\.)ixellio\.fr$/i.test(u.hostname)) return null;
  const path = u.pathname.replace(/;jsessionid=[^/?]*/i, "");
  if (/logout|j_spring|deconnex/i.test(path)) return null;
  const method = u.searchParams.get("method");
  const safeMethod = method && /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(method) ? method : null;
  const paramNames = [...new Set([...u.searchParams.keys()].filter((k) => k !== "method" && !HIDE_PARAM.test(k) && /^[\w.\-[\]]{1,40}$/.test(k)))];
  return { path: `${path}${safeMethod ? `?method=${safeMethod}` : ""}`, paramNames };
}

const RX = {
  temps: /temps\s*(bar[ée]m|constructeur|de\s*main|mo\b)|bar[ée]m|main[\s-]*d['’\s]*(œ|oe)uvre|\bM\.?O\.?\b|\bT[123]\b|labou?r|tarif\s*horaire|temps\s*(atelier|m[ée]ca)/i,
  chiffrage: /chiffrage|devis|estimation/i,
  pieces: /pi[èe]ce|catalogue|r[ée]f[ée]rence/i,
  vehicule: /v[ée]hicule|immat|\bvin\b|ident|motoris|version|mod[èe]le/i,
  documentation: /documentation|technique|entretien|maintenance|r[ée]vision|sch[ée]ma|notice|m[ée]thode/i,
};
export function categorize(label: string, path: string): MenuCategory {
  const s = `${label} ${path}`;
  if (/redressage|r[ée]paration|peinture/i.test(label)) return "chiffrage"; // carrosserie : jamais TM mécanique
  // Libellé exact « Temps » ou page /Temps.html : entrée temps du menu (pas une rubrique de chiffrage carrosserie).
  if (/^temps$/i.test(label.trim()) || /^\/Temps\.html(\?|$)/i.test(path)) return "temps_bareme";
  if (/^forfaits?$/i.test(label.trim()) || /^\/Forfait\.html(\?|$)/i.test(path)) return "forfaits";
  if (RX.temps.test(s)) return "temps_bareme";
  if (RX.chiffrage.test(s)) return "chiffrage";
  if (RX.pieces.test(s)) return "pieces";
  if (RX.vehicule.test(s)) return "vehicule";
  if (RX.documentation.test(s)) return "documentation";
  return "autre";
}
const needsVehicle = (label: string, path: string, params: string[]) =>
  /immat|\bvin\b|v[ée]hicule|ident|version|motoris/i.test(`${label} ${path}`) || params.some((p) => /immat|vin|vehic|version|idv|type/i.test(p));
const needsOperation = (label: string, path: string, params: string[]) =>
  /op[ée]ration|intervention|prestation/i.test(`${label} ${path}`) || params.some((p) => /oper|interv|presta|code/i.test(p));

const SCRIPT_URL = /["'](\/?[A-Za-z][\w/-]*\.(?:html|do|action|json)(?:\?[^"'\s<>]*)?)["']/g;

export function inspectIxellioMenu(html: string): MenuInspection {
  const doc = parse(html) as unknown as Node;
  let title = "";
  const entries = new Map<string, MenuEntry>();
  const forms: MenuForm[] = [];
  const limitations: string[] = [];
  const add = (raw: string, label: string, via: MenuEntry["via"], httpMethod: "GET" | "POST" = "GET") => {
    const s = sanitizeInternalUrl(raw);
    if (!s) return;
    const lab = safeLabel(clean(label), "", 50) || "—";
    const key = `${httpMethod} ${s.path}`;
    const prev = entries.get(key);
    if (prev) { prev.paramNames = [...new Set([...prev.paramNames, ...s.paramNames])]; if (prev.label === "—") prev.label = lab; return; }
    entries.set(key, {
      label: lab, path: s.path, httpMethod, paramNames: s.paramNames, via, category: categorize(lab, s.path),
      needsVehicle: needsVehicle(lab, s.path, s.paramNames), needsOperation: needsOperation(lab, s.path, s.paramNames),
    });
  };
  walk(doc, (n) => {
    if (n.tagName === "title" && !title) title = safeLabel(clean(text({ ...n, nodeName: "x" })), "", 60);
    if (n.tagName === "a" || n.tagName === "area") {
      const label = clean(text(n)) || attr(n, "title") || attr(n, "alt");
      const href = attr(n, "href");
      if (href) add(href, label, "lien");
      const on = attr(n, "onclick");
      for (const m of on.matchAll(SCRIPT_URL)) add(m[1]!, label, "script");
    }
    if ((n.tagName === "button" || n.tagName === "input" || n.tagName === "div" || n.tagName === "td" || n.tagName === "li" || n.tagName === "span") && attr(n, "onclick")) {
      for (const m of attr(n, "onclick").matchAll(SCRIPT_URL)) add(m[1]!, clean(text(n)) || attr(n, "value") || attr(n, "title"), "script");
    }
    if (n.tagName === "form") {
      const s = sanitizeInternalUrl(attr(n, "action") || "/");
      const httpMethod = /post/i.test(attr(n, "method")) ? "POST" : "GET";
      const fields: MenuForm["fields"] = [];
      walk(n, (c) => {
        if (c.tagName === "input" || c.tagName === "select" || c.tagName === "textarea") {
          const name = attr(c, "name");
          if (!name || HIDE_PARAM.test(name) || !/^[\w.\-[\]]{1,40}$/.test(name)) return;
          fields.push({ name, type: c.tagName === "input" ? (attr(c, "type") || "text").toLowerCase() : c.tagName });
        }
      });
      if (s) {
        forms.push({ path: s.path, httpMethod, fields });
        const label = fields.map((f) => f.name).join(" ");
        add(attr(n, "action") || "/", `formulaire ${label}`.slice(0, 50), "formulaire", httpMethod);
      }
    }
    if (n.nodeName === "script") {
      const src = attr(n, "src");
      if (src) return;
      const body = (n.childNodes ?? []).map((c) => c.value ?? "").join("");
      for (const m of body.matchAll(SCRIPT_URL)) add(m[1]!, "", "script");
    }
    if (n.nodeName === "#text") {
      const t = clean(n.value ?? "");
      if (/non\s+souscri|abonnement|acc[èe]s\s+(refus|restreint|interdit)|droits?\s+insuffisant|module\s+non\s+(activ|disponib)/i.test(t) && limitations.length < 5)
        limitations.push(safeLabel(t, "", 80));
    }
  });
  const all = clean(text(doc)).toLowerCase();
  const isLoginPage = /j_password|j_username/.test(html) && !/mainmenu/i.test(html) || /mot de passe oubli/.test(all) && /identifiant/.test(all) && entries.size < 3;
  return { isLoginPage, title, entries: [...entries.values()], forms, limitations, laborCandidates: parseLaborTimes(html).times.length };
}

const UNIT_H = /\((?:h|heures?)\)|\ben\s+heures?\b|\bheures?\b|\(h\)/i;
const UNIT_MIN = /\((?:min|minutes?)\)|\ben\s+minutes?\b|\bminutes?\b/i;
const NUM = /^(\d{1,3}(?:[.,]\d{1,3})?)$/;

/**
 * Extraction STRICTE : tableau dont la ligne d'en-tête contient une colonne opération (Code/Opération/Libellé)
 * ET une colonne temps avec unité déclarée (h ou min). Lignes Redressage/Réparation/Peinture exclues.
 * UT ou unité absente => aucune durée (structure_unknown). Jamais d'inférence.
 */
export function parseLaborTimes(html: string): { times: IxellioLaborTime[]; status: LaborStatus | null } {
  const doc = parse(html) as unknown as Node;
  const times: IxellioLaborTime[] = [];
  let sawTimeHeaderWithoutUnit = false;
  const tables: Node[] = [];
  walk(doc, (n) => { if (n.tagName === "table") tables.push(n); });
  const ownRows = (t: Node) => {
    const out: Node[] = [];
    const rec = (n: Node) => { for (const c of n.childNodes ?? []) { if (c.tagName === "table") continue; if (c.tagName === "tr") out.push(c); else rec(c); } };
    rec(t);
    return out;
  };
  const cells = (tr: Node) => (tr.childNodes ?? []).filter((c) => c.tagName === "td" || c.tagName === "th").map((c) => clean(text(c)));
  for (const t of tables) {
    const rows = ownRows(t);
    if (rows.length < 2) continue;
    const head = cells(rows[0]!);
    const iTime = head.findIndex((h) => /temps|dur[ée]e|bar[èe]me/i.test(h) && !/redressage|r[ée]paration|peinture/i.test(h));
    const iOp = head.findIndex((h) => /op[ée]ration|libell[ée]|intervention/i.test(h));
    const iCode = head.findIndex((h) => /^code/i.test(h));
    const iGrade = head.findIndex((h) => /niveau|cat[ée]gorie\s*mo|\bT1\b|qualif/i.test(h));
    if (iTime < 0 || iOp < 0) continue;
    if (head.some((h) => /redressage|r[ée]paration|peinture/i.test(h))) continue;
    const unit = UNIT_MIN.test(head[iTime]!) ? "min" : UNIT_H.test(head[iTime]!) ? "h" : null;
    if (!unit) { sawTimeHeaderWithoutUnit = true; continue; }
    for (const r of rows.slice(1)) {
      const c = cells(r);
      const label = c[iOp] ?? "";
      if (!label || /redressage|r[ée]paration|peinture/i.test(label)) continue;
      const m = (c[iTime] ?? "").match(NUM);
      if (!m) continue;
      const v = Number(m[1]!.replace(",", "."));
      if (!Number.isFinite(v) || v <= 0) continue;
      const g = iGrade >= 0 ? (c[iGrade] ?? "").match(/\bT([123])\b/) : null;
      times.push({
        operationCode: iCode >= 0 && c[iCode] ? c[iCode]!.slice(0, 30) : null,
        operationLabel: label.slice(0, 80),
        vehicleMatch: null,
        durationHours: unit === "h" ? v : Math.round((v / 60) * 10000) / 10000,
        timeUnitOriginal: unit,
        labourGrade: g ? (`T${g[1]}` as LaborGrade) : null,
        sourceMethod: "tableau explicite (en-tête opération + temps avec unité)",
        confidence: "explicite",
      });
    }
  }
  return { times, status: times.length ? null : sawTimeHeaderWithoutUnit ? "structure_unknown" : "no_result" };
}

/** Statut d'accès aux TM depuis le menu : jamais « récupérés » sans temps explicites. */
export function laborAccessStatus(m: MenuInspection):
  | { code: "page_connexion" | "menu_vide" | "aucun_lien_tm" | "menu_identifie_tm_non_recuperes" | "acces_limite"; laborStatus: LaborStatus } {
  if (m.isLoginPage) return { code: "page_connexion", laborStatus: "structure_unknown" };
  if (m.limitations.length) return { code: "acces_limite", laborStatus: "structure_unknown" };
  if (!m.entries.length) return { code: "menu_vide", laborStatus: "structure_unknown" };
  const tm = m.entries.filter((e) => e.category === "temps_bareme");
  if (!tm.length) return { code: "aucun_lien_tm", laborStatus: "structure_unknown" };
  const laborStatus: LaborStatus = tm.every((e) => e.needsVehicle) ? "needs_vehicle" : tm.every((e) => e.needsOperation) ? "needs_operation" : "structure_unknown";
  return { code: "menu_identifie_tm_non_recuperes", laborStatus };
}

export type TempsPageInspection = {
  title: string;
  isLoginPage: boolean;
  limitations: string[];
  headings: string[];
  links: MenuEntry[];
  forms: MenuForm[];
  /** Champs de recherche (noms/types) liés à un véhicule ou une opération. */
  searchFields: { name: string; type: string; hint: "vehicule" | "operation" | "autre" }[];
  needsVehicle: boolean;
  needsOperation: boolean;
  tableCount: number;
  /** Tableau explicite opération + temps avec unité déclarée (lignes comptées, non affichées). */
  explicitTimeRows: number;
  timeHeaderWithoutUnit: boolean;
  /** TM affichables : uniquement si liaison véhicule/opération explicite — jamais à cette étape. */
  times: IxellioLaborTime[];
};

/** Inspection PURE de la page /Temps.html?method=search (aucune valeur de champ, libellés masqués). */
export function inspectTempsPage(html: string): TempsPageInspection {
  const m = inspectIxellioMenu(html);
  const doc = parse(html) as unknown as Node;
  const headings: string[] = [];
  let tableCount = 0;
  walk(doc, (n) => {
    if (n.tagName === "table") tableCount++;
    if (n.tagName && /^(h[1-4]|legend|label|th|caption)$/.test(n.tagName) && headings.length < 30) {
      const t = safeLabel(clean(text(n)), "", 50).replace(/\b[A-Z]{2}-?\d{3}-?[A-Z]{2}\b/g, "[immat]");
      if (t && !headings.includes(t) && !/mot de passe|identifiant|login/i.test(t)) headings.push(t);
    }
  });
  const hint = (name: string): "vehicule" | "operation" | "autre" =>
    /immat|vin|vehic|version|motor|marque|modele|model|type/i.test(name) ? "vehicule" : /oper|interv|presta|code|libelle|temps/i.test(name) ? "operation" : "autre";
  const searchFields = m.forms.flatMap((f) => f.fields.filter((x) => !/hidden|submit|button|image|reset/.test(x.type)).map((x) => ({ ...x, hint: hint(x.name) })));
  const parsed = parseLaborTimes(html);
  return {
    title: m.title, isLoginPage: m.isLoginPage, limitations: m.limitations, headings, links: m.entries.filter((e) => e.via !== "formulaire"), forms: m.forms,
    searchFields,
    needsVehicle: searchFields.some((f) => f.hint === "vehicule") || m.entries.some((e) => e.via === "formulaire" && e.needsVehicle),
    needsOperation: searchFields.some((f) => f.hint === "operation"),
    tableCount, explicitTimeRows: parsed.times.length, timeHeaderWithoutUnit: parsed.status === "structure_unknown",
    times: [], // liaison véhicule/opération non établie à cette étape : aucun TM affiché
  };
}
