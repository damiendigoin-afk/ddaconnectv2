/**
 * « Inspecter scripts IXELLIO » (manager, lecture seule, sur clic uniquement) : un login, puis
 * EXACTEMENT deux GET sur des fichiers JS fixes du même hôte. Aucune redirection suivie, JS seulement,
 * 600 Ko max par fichier, rien stocké. Renvoie une analyse assainie (jamais le code).
 */
import { analyzeJsFlow, FLOW_TARGETS, type JsFlow } from "./ixellio-js-flow";
import { acquireIxellio, releaseIxellio } from "./ixellio-lock.server";
import { safeEndpoints, type SafeEndpoint } from "./ixellio-parts-replace";
import { loadIxellioCredentials } from "./ixellio-store.server";
import { BROWSER_HEADERS, cookieHeader, openIxellioSession } from "./ixellio.server";

export const IXELLIO_SCRIPT_FILES = ["/scripts/pieceRecherche.js", "/scripts/intervention.js"] as const;
export const IXELLIO_SCRIPT_MAX_BYTES = 600_000;
const HOST = "https://www.ixellio.fr";
const REFERER = `${HOST}/PieceRecherche.html`;

export type ScriptFileReport = {
  path: string;
  status: number | null;
  bytes: number;
  outcome: "analysé" | "redirection non suivie" | "type non JS" | "trop volumineux" | "erreur HTTP" | "erreur réseau";
  keywords: { word: string; count: number }[];
  functions: string[];
  endpoints: SafeEndpoint[];
  flow: JsFlow | null;
  /** Vrai seulement si une fonction de la chaîne porte à la fois un littéral « min » et un appel réseau. */
  timeSourceVisible: boolean;
};
export type IxellioScriptsDiag = { status: "ok" | "partiel" | "not_configured" | "auth_failed" | "busy" | "rate_limited" | "network_error"; message: string; files: ScriptFileReport[]; trace: string[]; durationMs: number };

const KEYS: [string, RegExp][] = [["selectPiece", /selectPiece/g], ["initInterventions", /initInterventions/g], ["saveSelectionToChiffrage", /saveSelectionToChiffrage/g], ["popup", /popup|popin|dialog/gi], ["Remplacer", /remplacer/gi], ["minutes", /\b(min|mn|minutes?)\b/gi], ["temps", /\btemps\b/gi], ["ajax", /\$\.(ajax|post|get)|fetch\(|XMLHttpRequest/g]];
const FN_RE = /select|popup|popin|interv|chiffr|temps|remplac|piece|operation|dialog|time|minute/i;

/** Analyse PURE d'un fichier JS reçu (testable). */
export function analyzeScriptFile(path: string, status: number, contentType: string | null, js: string): ScriptFileReport {
  const base: ScriptFileReport = { path, status, bytes: js.length, outcome: "analysé", keywords: [], functions: [], endpoints: [], flow: null, timeSourceVisible: false };
  if (status >= 300 && status < 400) return { ...base, bytes: 0, outcome: "redirection non suivie" };
  if (status !== 200) return { ...base, bytes: 0, outcome: "erreur HTTP" };
  if (!/javascript|ecmascript/i.test(contentType ?? "") || /^\s*</.test(js)) return { ...base, bytes: 0, outcome: "type non JS" };
  if (js.length > IXELLIO_SCRIPT_MAX_BYTES) return { ...base, outcome: "trop volumineux" };
  const fns = new Set<string>();
  for (const m of js.matchAll(/function\s+([A-Za-z_$][\w$]{1,40})|([A-Za-z_$][\w$]{1,40})\s*[:=]\s*function/g)) {
    const f = m[1] ?? m[2]!;
    if (FN_RE.test(f) && fns.size < 20) fns.add(f);
  }
  const flow = analyzeJsFlow(js, FLOW_TARGETS);
  return {
    ...base,
    keywords: KEYS.map(([word, re]) => ({ word, count: (js.match(re) ?? []).length })),
    functions: [...fns],
    endpoints: safeEndpoints(js).slice(0, 12),
    flow,
    timeSourceVisible: flow.functions.some((f) => f.minuteUnitExplicit && f.ajax.length > 0),
  };
}

export async function inspectIxellioScripts(): Promise<IxellioScriptsDiag> {
  const started = Date.now();
  const trace: string[] = [];
  const files: ScriptFileReport[] = [];
  const out = (status: IxellioScriptsDiag["status"], message: string): IxellioScriptsDiag => ({ status, message, files, trace, durationMs: Date.now() - started });
  const creds = await loadIxellioCredentials();
  if (!creds) return out("not_configured", "IXELLIO n'est pas configuré dans Paramètres API.");
  const lock = acquireIxellio();
  if (!lock.ok) return lock.reason === "busy" ? out("busy", "Une consultation IXELLIO est déjà en cours (licence mono-session).") : out("rate_limited", "Patientez quelques secondes entre deux consultations IXELLIO.");
  try {
    const session = await openIxellioSession(creds, trace);
    if (!session.ok) return out("auth_failed", session.message);
    for (const path of IXELLIO_SCRIPT_FILES) {
      try {
        const res = await fetch(`${HOST}${path}`, { redirect: "manual", headers: { ...BROWSER_HEADERS, accept: "application/javascript,text/javascript,*/*;q=0.1", referer: REFERER, cookie: cookieHeader(session.jar) } });
        const len = Number(res.headers.get("content-length") ?? 0);
        const tooBig = len > IXELLIO_SCRIPT_MAX_BYTES;
        let js = "";
        if (res.status === 200 && !tooBig) js = await res.text();
        else await res.body?.cancel().catch(() => undefined);
        const r = tooBig
          ? { ...analyzeScriptFile(path, res.status, res.headers.get("content-type"), ""), bytes: len, outcome: "trop volumineux" as const }
          : analyzeScriptFile(path, res.status, res.headers.get("content-type"), js);
        files.push(r);
        trace.push(`GET ${path} ${res.status} (${r.bytes} o) — ${r.outcome}`);
      } catch {
        files.push({ path, status: null, bytes: 0, outcome: "erreur réseau", keywords: [], functions: [], endpoints: [], flow: null, timeSourceVisible: false });
        trace.push(`GET ${path} erreur réseau`);
      }
    }
    const ok = files.filter((f) => f.outcome === "analysé").length;
    return out(ok === IXELLIO_SCRIPT_FILES.length ? "ok" : "partiel", `${ok}/${IXELLIO_SCRIPT_FILES.length} fichier(s) analysé(s). Aucun temps extrait ; aucune action IXELLIO déclenchée.`);
  } catch (e) {
    return out("network_error", `Erreur réseau : ${e instanceof Error ? e.message : "inconnue"}`);
  } finally {
    releaseIxellio();
  }
}
