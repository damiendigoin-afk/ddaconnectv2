/**
 * Analyse statique PURE d'un JavaScript IXELLIO (inline ou fichier) : chaîne de sélection pièce →
 * fenêtre interventions → temps. Ne renvoie JAMAIS de code, de chaînes, de valeurs ni de jetons :
 * seulement noms de fonctions/paramètres (identifiants), méthodes HTTP littérales, chemins internes
 * + paramètre method (safeEndpoints), formes d'identifiants DOM masquées, booléens.
 */
import { nameShape, safeEndpoints, type SafeEndpoint } from "./ixellio-parts-replace";

export const FLOW_TARGETS = [
  "selectPiece", "menuInterventions", "afficheMenuIntervention", "selectCodeIntervention", "autoSelectIntervention",
  "valideInterventions", "masqueMenuIntervention", "deSelectPiece", "buildSelectionPiece", "buildPiece",
  "buildTempsRedressage", "saveSelection", "saveSelectionToChiffrage", "saveSelectionToNewChiffrage",
  "initInterventions", "selectElement", "createPopupToDisplayContent", "dialog",
] as const;

/** Rôles établis par lecture du source PUBLIC /scripts/pieceRecherche.js + /scripts/intervention.js (11/2026). */
export const VERIFIED_ROLES: Record<string, string> = {
  selectPiece: "clic ligne → menuInterventions si code élément, sinon sélection simple",
  menuInterventions: "choisit la liste d'interventions (mécanique/carrosserie) → afficheMenuIntervention",
  afficheMenuIntervention: "construit la fenêtre (cases Remplacer…, OK → valideInterventions, Annuler → masqueMenuIntervention)",
  selectCodeIntervention: "coche/décoche un code (variable mémoire), désactive les incompatibles",
  autoSelectIntervention: "type 0 : Remplacer automatique puis valideInterventions",
  valideInterventions: "bouton OK : affiche des blocs DÉJÀ présents dans la page (divTempsRemplacement_, réparation, peinture), aucun réseau",
  masqueMenuIntervention: "ferme la fenêtre",
  buildSelectionPiece: "prépare le champ formulaire selection avant envoi",
  buildTempsRedressage: "lit les temps SAISIS redressage/réparation (carrosserie, saisie garage)",
  saveSelection: "ENVOI formulaire → chiffrage (écriture)",
  saveSelectionToChiffrage: "ENVOI formulaire addToChiffrage (écriture)",
  saveSelectionToNewChiffrage: "ENVOI formulaire addToNewChiffrage (écriture)",
};

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
  /** Champs du formulaire nommés (document.xForm.champ) — noms seulement. */
  formFields?: string[];
  /** Valeurs littérales affectées à form.method.value (noms d'action, identifiants seulement). */
  submitMethods?: string[];
  submits?: boolean;
  timeRefs?: boolean;
  okHandlers?: string[];
};
export type JsFlow = {
  functions: FnFlow[];
  declared: number;
  okCallsSave: "probable" | "non déterminé";
  /** Fonction(s) branchée(s) sur le bouton OK de la fenêtre générée. */
  okHandlers: string[];
  /** Variables globales (hors fonctions) liées aux interventions/temps — noms seulement. */
  globals: string[];
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
    formFields: [...new Set([...body.matchAll(/document\.[A-Za-z_$][\w$]{0,40}Form\.([A-Za-z_$][\w$]{0,40})/g)].map((m) => m[1]!))].filter((n) => n !== "submit").slice(0, 12),
    submitMethods: [...new Set([...body.matchAll(/\.method\.value\s*=\s*["']([A-Za-z]{1,40})["']/g)].map((m) => m[1]!))].slice(0, 5),
    submits: /\.submit\s*\(/.test(body),
    timeRefs: /temps|duree|durée|minute/i.test(body),
    okHandlers: okHandlersIn(body),
  };
}

function okHandlersIn(body: string): string[] {
  const i = body.search(/TXT_OK\b|value=\\?["']\s*OK\s*\\?["']/);
  if (i < 0) return [];
  const m = /javascript:([A-Za-z_$][\w$]{0,40})\s*\(/.exec(body.slice(i, i + 400));
  return m ? [m[1]!] : [];
}

export function analyzeJsFlow(js: string, targets: readonly string[] = FLOW_TARGETS): JsFlow {
  const decls = declarations(js);
  const functions: FnFlow[] = targets.slice(0, 20).map((name) => {
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
  const okHandlers = [...new Set(functions.flatMap((f) => f.okHandlers ?? []))];
  if (okHandlers.length && !okHandlers.includes("saveSelectionToChiffrage") && okCallsSave === "probable") okCallsSave = "non déterminé";
  let outside = js;
  for (const d of [...decls].reverse()) { const e = matchBrace(js, d.open); if (e > 0) outside = outside.slice(0, d.open) + outside.slice(e + 1); }
  const globals = [...new Set([...outside.matchAll(/\bvar\s+([A-Za-z_$][\w$]{0,40})/g)].map((m) => m[1]!))].filter((n) => /interv|temps|duree|minute|piece/i.test(n)).slice(0, 15);
  const save = functions.find((f) => f.name === "saveSelectionToChiffrage");
  const saveIsMutating: JsFlow["saveIsMutating"] = !save || !save.exists ? "fonction absente" : save.ajax.length || save.outcomes.includes("navigation") || WRITE.test(save.name) ? "probable" : "non déterminé";
  const warnings: string[] = [];
  const missing = functions.filter((f) => !f.exists).map((f) => f.name);
  if (okHandlers.length) warnings.push(`Bouton OK de la fenêtre → ${okHandlers.join(", ")}.`);
  if (missing.length) warnings.push(`Non définie(s) dans ce script : ${missing.join(", ")}.`);
  if (functions.some((f) => f.parse === "non analysable")) warnings.push("Corps de fonction non analysable (accolades/chaînes déséquilibrées) : résultat incomplet.");
  if (saveIsMutating === "probable") warnings.push("saveSelectionToChiffrage = écriture probable dans le chiffrage IXELLIO : ne jamais l'appeler ni simuler « OK » à distance.");
  if (!functions.some((f) => f.minuteUnitExplicit) && !functions.some((f) => f.ajax.length)) warnings.push("Aucun appel réseau ni unité « min » dans ces fonctions : un temps éventuel est déjà dans la page de résultats (bloc masqué), pas calculé à la demande.");
  warnings.push("Analyse statique : flux probable, non confirmé à l'exécution. Aucune durée extraite.");
  return { functions, declared: decls.length, okCallsSave, okHandlers, globals, saveIsMutating, warnings };
}
