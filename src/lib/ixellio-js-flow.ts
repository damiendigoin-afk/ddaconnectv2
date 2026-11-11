/**
 * Analyse statique PURE d'un JavaScript IXELLIO (inline ou fichier) : chaîne de sélection pièce →
 * fenêtre interventions → temps. Ne renvoie JAMAIS de code, de chaînes, de valeurs ni de jetons :
 * seulement noms de fonctions/paramètres (identifiants), méthodes HTTP littérales, chemins internes
 * + paramètre method (safeEndpoints), formes d'identifiants DOM masquées, booléens.
 */
import { nameShape, safeEndpoints, type SafeEndpoint } from "./ixellio-parts-replace";

export const FLOW_TARGETS = ["selectPiece", "initInterventions", "selectElement", "createPopupToDisplayContent", "saveSelectionToChiffrage", "dialog"] as const;

export type FnFlow = {
  name: string;
  exists: boolean;
  parse: "ok" | "non analysable" | "absente";
  params: string[];
  calls: string[];
  ajax: { fn: string; method: "GET" | "POST" | "INCONNUE" }[];
  endpoints: SafeEndpoint[];
  domShapes: string[];
  buildsCheckboxes: boolean;
  interventionList: boolean;
  minuteUnitExplicit: boolean;
  outcomes: ("popup" | "navigation" | "réseau" | "écriture chiffrage probable")[];
};
export type JsFlow = {
  functions: FnFlow[];
  declared: number;
  okCallsSave: "probable" | "non déterminé";
  saveIsMutating: "probable" | "non déterminé" | "fonction absente";
  warnings: string[];
};

const KW = new Set(["if", "for", "while", "switch", "return", "function", "typeof", "new", "catch", "var", "let", "const", "this", "else", "do", "try", "in", "of", "delete", "void", "with"]);
const ID = /^[A-Za-z_$][\w$]{0,40}$/;
const WRITE = /^(add|save|update|insert|create|remove|delete|edit|valid|store|put)/i;

/** Indice de fin du bloc { … } ouvert à `open`, en sautant chaînes, gabarits et commentaires ; -1 si déséquilibré. */
export function matchBrace(js: string, open: number): number {
  let depth = 0;
  for (let i = open; i < js.length; i++) {
    const c = js[i]!;
    if (c === "/" && js[i + 1] === "/") { const e = js.indexOf("\n", i); if (e < 0) return -1; i = e; continue; }
    if (c === "/" && js[i + 1] === "*") { const e = js.indexOf("*/", i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < js.length && js[j] !== c) { if (js[j] === "\\") j++; j++; }
      if (j >= js.length) return -1;
      i = j; continue;
    }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Littéraux de chaîne (usage interne seulement, jamais renvoyés). */
const literals = (body: string) => [...body.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]!);

type Decl = { name: string; params: string; open: number };
function declarations(js: string): Decl[] {
  const out: Decl[] = [];
  const re = /function\s+([A-Za-z_$][\w$]{0,40})\s*\(([^)]{0,200})\)\s*\{|([A-Za-z_$][\w$]{0,40})\s*[:=]\s*function\s*[A-Za-z_$\w]*\s*\(([^)]{0,200})\)\s*\{/g;
  for (const m of js.matchAll(re)) out.push({ name: m[1] ?? m[3]!, params: m[2] ?? m[4] ?? "", open: m.index! + m[0].length - 1 });
  return out;
}

function analyzeBody(name: string, params: string, body: string): Omit<FnFlow, "exists" | "parse"> {
  const calls = new Set<string>();
  for (const m of body.matchAll(/([A-Za-z_$][\w$]{0,40})\s*\(/g)) if (!KW.has(m[1]!) && calls.size < 20) calls.add(m[1]!);
  const ajax: FnFlow["ajax"] = [];
  const lits = literals(body);
  const methodLit = lits.filter((l) => /^(GET|POST)$/i.test(l)).map((l) => l.toUpperCase() as "GET" | "POST");
  for (const m of body.matchAll(/\$\.(ajax|post|get|getJSON)\s*\(|\b(fetch)\s*\(|new\s+(XMLHttpRequest)|\.(load)\s*\(/g)) {
    const fn = m[1] ?? m[2] ?? m[3] ?? m[4]!;
    const method = fn === "post" ? "POST" : fn === "get" || fn === "getJSON" || fn === "load" ? "GET" : new Set(methodLit).size === 1 ? methodLit[0]! : "INCONNUE";
    if (ajax.length < 10) ajax.push({ fn: fn === "fetch" || fn === "XMLHttpRequest" ? fn : `$.${fn}`, method });
  }
  const dom = new Set<string>();
  for (const m of body.matchAll(/getElementById\(\s*['"]([\w-]{1,60})['"]|\$\(\s*['"]#([\w-]{1,60})|\[name=['"]?([\w-]{1,60})/g)) {
    const s = nameShape(m[1] ?? m[2] ?? m[3]!);
    if (s && dom.size < 10) dom.add(s);
  }
  const endpoints = safeEndpoints(body);
  const outcomes: FnFlow["outcomes"] = [];
  if (/\.dialog\s*\(|createPopup|popin|popup/i.test(body)) outcomes.push("popup");
  if (/(?:window\.|document\.)?location(?:\.href)?\s*=|\.submit\s*\(/.test(body)) outcomes.push("navigation");
  if (ajax.length) outcomes.push("réseau");
  if (endpoints.some((e) => /chiffrage/i.test(e.path) && WRITE.test(e.method ?? "")) || (/chiffrage/i.test(name) && WRITE.test(name) && ajax.length))
    outcomes.push("écriture chiffrage probable");
  return {
    name,
    params: params.split(",").map((p) => p.trim().replace(/=.*$/, "")).filter((p) => ID.test(p)).slice(0, 8),
    calls: [...calls], ajax, endpoints, domShapes: [...dom],
    buildsCheckboxes: /type\s*=\s*\\?["']?checkbox|:checkbox|["']checkbox["']/i.test(body),
    interventionList: /intervention/i.test(body),
    minuteUnitExplicit: lits.some((l) => /\b(min|mn|minutes?)\b/i.test(l)),
    outcomes,
  };
}

export function analyzeJsFlow(js: string, targets: readonly string[] = FLOW_TARGETS): JsFlow {
  const decls = declarations(js);
  const functions: FnFlow[] = targets.slice(0, 6).map((name) => {
    const d = decls.find((x) => x.name === name);
    const blank = { name, params: [], calls: [], ajax: [], endpoints: [], domShapes: [], buildsCheckboxes: false, interventionList: false, minuteUnitExplicit: false, outcomes: [] };
    if (!d) return { ...blank, exists: false, parse: "absente" };
    const end = matchBrace(js, d.open);
    if (end < 0) return { ...blank, params: analyzeBody(name, d.params, "").params, exists: true, parse: "non analysable" };
    return { ...analyzeBody(name, d.params, js.slice(d.open, end + 1)), exists: true, parse: "ok" };
  });
  // OK → saveSelectionToChiffrage : bloc qui contient un littéral « OK » et appelle la fonction.
  let okCallsSave: JsFlow["okCallsSave"] = "non déterminé";
  for (const d of decls) {
    const end = matchBrace(js, d.open);
    if (end < 0) continue;
    const b = js.slice(d.open, end + 1);
    if (/saveSelectionToChiffrage\s*\(/.test(b) && (literals(b).some((l) => /^ok$/i.test(l.trim())) || /\bOK\s*:/.test(b))) { okCallsSave = "probable"; break; }
  }
  const save = functions.find((f) => f.name === "saveSelectionToChiffrage");
  const saveIsMutating: JsFlow["saveIsMutating"] = !save || !save.exists ? "fonction absente" : save.ajax.length || save.outcomes.includes("navigation") || WRITE.test(save.name) ? "probable" : "non déterminé";
  const warnings: string[] = [];
  const missing = functions.filter((f) => !f.exists).map((f) => f.name);
  if (missing.length) warnings.push(`Non définie(s) ici : ${missing.join(", ")} — probablement dans un fichier JS externe.`);
  if (functions.some((f) => f.parse === "non analysable")) warnings.push("Corps de fonction non analysable (accolades/chaînes déséquilibrées) : résultat incomplet.");
  if (saveIsMutating !== "fonction absente") warnings.push("saveSelectionToChiffrage = écriture probable dans le chiffrage IXELLIO : ne jamais l'appeler ni simuler « OK » à distance.");
  if (!functions.some((f) => f.minuteUnitExplicit)) warnings.push("Aucune unité « min » littérale dans ces fonctions : le temps en minutes est probablement fourni dynamiquement (réponse serveur), invisible en statique.");
  warnings.push("Analyse statique : flux probable, non confirmé à l'exécution. Aucune durée extraite.");
  return { functions, declared: decls.length, okCallsSave, saveIsMutating, warnings };
}
