/**
 * Diagnostic « TM v2 — inspection page Temps » : LECTURE SEULE, manager. Un login (openIxellioSession),
 * puis EXACTEMENT UN GET sur le chemin codé en dur /Temps.html?method=search (aucune URL saisie,
 * aucun POST, aucun formulaire soumis, aucune redirection suivie). Verrou IXELLIO partagé (15 s).
 * Jamais renvoyé : cookies, CSRF, HTML, identifiants, valeurs de champs.
 */
import { inspectTempsPage, type TempsPageInspection } from "./ixellio-labor-parse";
import { acquireIxellio, releaseIxellio } from "./ixellio-lock.server";
import { loadIxellioCredentials } from "./ixellio-store.server";
import { BROWSER_HEADERS, cookieHeader, looksLikeLoginPage, openIxellioSession } from "./ixellio.server";

export const TEMPS_PAGE_URL = "https://www.ixellio.fr/Temps.html?method=search";
const REFERER = "https://www.ixellio.fr/mainMenu.html?method=index";

export type TempsPageStatus =
  | "page_lue_tm_non_recuperes" | "page_connexion" | "redirection" | "acces_refuse" | "http_error" | "acces_limite"
  | "not_configured" | "auth_failed" | "busy" | "rate_limited" | "network_error";

export type IxellioTempsPageDiag = {
  status: TempsPageStatus;
  message: string;
  getStatus: number | null;
  redirectKind: "connexion" | "externe" | "interne" | null;
  bytes: number;
  page: TempsPageInspection | null;
  tmExtracted: false;
  trace: string[];
  durationMs: number;
};

/** Classement PUR de la réponse du GET (testable sans réseau). */
export function classifyTempsResponse(status: number, location: string | null, html: string):
  { status: TempsPageStatus; redirectKind: IxellioTempsPageDiag["redirectKind"]; page: TempsPageInspection | null; message: string } {
  if (status >= 300 && status < 400) {
    let kind: "connexion" | "externe" | "interne" = "interne";
    try {
      const u = new URL(location ?? "", "https://www.ixellio.fr/");
      kind = !/(^|\.)ixellio\.fr$/i.test(u.hostname) ? "externe" : /login|index\.html|j_spring|denied|error/i.test(u.pathname) ? "connexion" : "interne";
    } catch { kind = "externe"; }
    return { status: kind === "connexion" ? "page_connexion" : "redirection", redirectKind: kind, page: null,
      message: kind === "connexion" ? "Redirigé vers la connexion : page Temps non accessible avec cette session." : `Redirection ${kind} non suivie (lecture seule).` };
  }
  if (status === 401 || status === 403) return { status: "acces_refuse", redirectKind: null, page: null, message: `IXELLIO refuse l'accès à la page Temps (HTTP ${status}) : module peut-être non souscrit.` };
  if (status !== 200) return { status: "http_error", redirectKind: null, page: null, message: `IXELLIO a répondu HTTP ${status}.` };
  if (looksLikeLoginPage(html)) return { status: "page_connexion", redirectKind: null, page: null, message: "La réponse est la page de connexion : accès non établi." };
  const page = inspectTempsPage(html);
  if (page.limitations.length) return { status: "acces_limite", redirectKind: null, page, message: "La page Temps signale un accès limité." };
  return { status: "page_lue_tm_non_recuperes", redirectKind: null, page,
    message: "Page Temps lue (GET réussi). Aucun temps barémé récupéré : la page n'a pas été interrogée pour un véhicule/une opération." };
}

export async function inspectIxellioTempsPage(): Promise<IxellioTempsPageDiag> {
  const started = Date.now();
  const trace: string[] = [];
  const out = (status: TempsPageStatus, message: string, extra: Partial<IxellioTempsPageDiag> = {}): IxellioTempsPageDiag => ({
    status, message, getStatus: null, redirectKind: null, bytes: 0, page: null, tmExtracted: false, trace, durationMs: Date.now() - started, ...extra,
  });
  const creds = await loadIxellioCredentials();
  if (!creds) return out("not_configured", "IXELLIO n'est pas configuré dans Paramètres API.");
  const lock = acquireIxellio();
  if (!lock.ok) return lock.reason === "busy"
    ? out("busy", "Une consultation IXELLIO est déjà en cours (licence mono-session).")
    : out("rate_limited", "Patientez quelques secondes entre deux consultations IXELLIO.");
  try {
    const session = await openIxellioSession(creds, trace);
    if (!session.ok) return out("auth_failed", session.message);
    const res = await fetch(TEMPS_PAGE_URL, { redirect: "manual", headers: { ...BROWSER_HEADERS, referer: REFERER, cookie: cookieHeader(session.jar) } });
    const html = res.status === 200 ? await res.text() : (await res.text().catch(() => ""), "");
    trace.push(`GET /Temps.html?method=search ${res.status} (${html.length} o) — requête unique, redirections non suivies`);
    const c = classifyTempsResponse(res.status, res.headers.get("location"), html);
    return out(c.status, c.message, { getStatus: res.status, redirectKind: c.redirectKind, bytes: html.length, page: c.page });
  } catch (e) {
    return out("network_error", `Erreur réseau : ${e instanceof Error ? e.message : "inconnue"}`);
  } finally {
    releaseIxellio();
  }
}
