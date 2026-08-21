/**
 * Test d'authentification IXELLIO côté serveur (Spring Security).
 *
 * Règles de sécurité strictes :
 *  - les identifiants ne sont JAMAIS journalisés, persistés ni renvoyés au client ;
 *  - les cookies de session restent en mémoire du serveur le temps de la requête ;
 *  - seules des données non sensibles (statut, chemins de redirection nettoyés,
 *    durée, champs véhicule) sortent.
 */

import { parseIxellioHtml, stripTags, type IxellioVehicle } from "./ixellio-parse";

const BASE = "https://www.ixellio.fr";
const LOGIN_URL = `${BASE}/j_spring_security_check`;
const SEARCH_URL = `${BASE}/ident.html?method=searchByImmat`;
const MAX_REDIRECTS = 3;

export type IxellioTestOutcome =
  | "auth_ok_vehicle_found"
  | "auth_ok_no_vehicle"
  | "auth_refused"
  | "redirect_to_login"
  | "network_error"
  | "unexpected_response";

export type { IxellioVehicle } from "./ixellio-parse";

export type IxellioTestResult = {
  outcome: IxellioTestOutcome;
  authenticated: boolean;
  loginStatus: number | null;
  searchStatus: number | null;
  loginRedirect: string | null;
  searchRedirect: string | null;
  trace: string[];
  durationMs: number;
  bytes: number;
  vehicle: IxellioVehicle;
  /** Diagnostic non sensible : noms des champs détectés (jamais les valeurs). */
  detectedFields: string[];
  fieldCount: number;
  pairCount: number;
  isVersionList: boolean;
  message: string;
};

/** Ne conserve que chemin + `method=` : supprime tout query param potentiellement sensible. */
function safePath(location: string): string {
  if (!location) return "";
  try {
    const u = new URL(location, BASE);
    const method = u.searchParams.get("method");
    const err = u.searchParams.has("error") || u.searchParams.has("login_error");
    return `${u.pathname}${method ? `?method=${method}` : ""}${err ? "?error" : ""}`;
  } catch {
    return location.split("?")[0] ?? "";
  }
}

/** Fusionne les cookies renvoyés par le serveur distant (jar minimaliste, en mémoire). */
function mergeCookies(jar: Map<string, string>, res: Response) {
  const raw =
    typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : [res.headers.get("set-cookie") ?? ""].filter(Boolean);
  for (const line of raw) {
    for (const part of line.split(/,(?=[^;]+?=)/)) {
      const first = part.split(";")[0] ?? "";
      const eq = first.indexOf("=");
      if (eq <= 0) continue;
      jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
    }
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function looksLikeLoginPage(html: string): boolean {
  const l = html.toLowerCase();
  return (
    l.includes("j_username") ||
    l.includes("j_password") ||
    l.includes("j_spring_security_check") ||
    (l.includes("mot de passe") && l.includes("identifiant"))
  );
}

function isLoginPath(p: string): boolean {
  return /login|error|denied|logout|j_spring/i.test(p);
}

/** En-têtes « navigateur » raisonnables (aucun secret). */
const BROWSER_HEADERS: Record<string, string> = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "fr-FR,fr;q=0.9,en;q=0.8",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

/**
 * Champs cachés du formulaire de login (CSRF Spring, execution, etc.).
 * Les VALEURS ne sont jamais tracées ni renvoyées : seuls les NOMS le sont.
 */
function extractHiddenFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const formRe = /<form[^>]*j_spring_security_check[^>]*>([\s\S]*?)<\/form>/i;
  const scope = formRe.exec(html)?.[1] ?? html;
  const inputRe = /<input\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = inputRe.exec(scope))) {
    const tag = m[0];
    if (!/type\s*=\s*["']?hidden/i.test(tag)) continue;
    const name = /name\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const value = /value\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
    if (!name || /^j_(username|password)$/i.test(name)) continue;
    fields[name] = value;
  }
  return fields;
}

type FollowResult = { status: number; html: string; finalPath: string; hops: string[] };

/** Suit jusqu'à MAX_REDIRECTS redirections GET en conservant le cookie jar. */
async function followRedirects(
  res: Response,
  jar: Map<string, string>,
  trace: string[],
  referer?: string,
): Promise<FollowResult> {
  let current = res;
  let html = "";
  let finalPath = "";
  const hops: string[] = [];

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    if (current.status >= 300 && current.status < 400) {
      const loc = current.headers.get("location") ?? "";
      const path = safePath(loc);
      hops.push(path || "(vide)");
      trace.push(`→ ${current.status} ${path || "(vide)"}`);
      await current.text();
      if (!loc || i === MAX_REDIRECTS) {
        finalPath = path;
        return { status: current.status, html: "", finalPath, hops };
      }
      const next = await fetch(new URL(loc, BASE).toString(), {
        method: "GET",
        redirect: "manual",
        headers: {
          ...BROWSER_HEADERS,
          ...(referer ? { referer } : {}),
          ...(jar.size ? { cookie: cookieHeader(jar) } : {}),
        },
      });
      mergeCookies(jar, next);
      finalPath = path;
      current = next;
      continue;
    }
    html = await current.text();
    trace.push(`→ ${current.status} (${html.length} o, ${jar.size} cookie(s))`);
    return { status: current.status, html, finalPath, hops };
  }

  return { status: current.status, html, finalPath, hops };
}


export async function runIxellioAuthTest(input: {
  username: string;
  password: string;
  plate: string;
}): Promise<IxellioTestResult> {
  const started = Date.now();
  // 5) Nouveau cookie jar à chaque test.
  const jar = new Map<string, string>();
  const trace: string[] = [];
  const base: IxellioTestResult = {
    outcome: "unexpected_response",
    authenticated: false,
    loginStatus: null,
    searchStatus: null,
    loginRedirect: null,
    searchRedirect: null,
    trace,
    durationMs: 0,
    bytes: 0,
    vehicle: {},
    detectedFields: [],
    fieldCount: 0,
    pairCount: 0,
    isVersionList: false,
    message: "",
  };
  const done = (patch: Partial<IxellioTestResult>): IxellioTestResult => ({
    ...base,
    ...patch,
    trace,
    durationMs: Date.now() - started,
  });

  try {
    // 1) Amorçage : GET de la page de login réelle, redirections suivies, cookies conservés.
    let loginPageHtml = "";
    let loginPageUrl = `${BASE}/index.html`;
    try {
      const seed = await fetch(loginPageUrl, { redirect: "manual", headers: BROWSER_HEADERS });
      mergeCookies(jar, seed);
      trace.push(`GET /index.html ${seed.status} (${jar.size} cookie(s))`);
      const seeded = await followRedirects(seed, jar, trace, `${BASE}/`);
      loginPageHtml = seeded.html;
      if (seeded.finalPath) loginPageUrl = new URL(seeded.finalPath, BASE).toString();
    } catch {
      /* non bloquant */
    }

    // 2) Champs cachés éventuels du formulaire (noms seulement dans la trace).
    const hidden = extractHiddenFields(loginPageHtml);
    const hiddenNames = Object.keys(hidden);
    trace.push(
      hiddenNames.length
        ? `champs cachés détectés : ${hiddenNames.join(", ")}`
        : "aucun champ caché détecté sur la page de login",
    );

    // 3) Authentification Spring Security avec en-têtes navigateur.
    const form = new URLSearchParams(hidden);
    form.set("j_username", input.username);
    form.set("j_password", input.password);

    const login = await fetch(LOGIN_URL, {
      method: "POST",
      redirect: "manual",
      headers: {
        ...BROWSER_HEADERS,
        "content-type": "application/x-www-form-urlencoded",
        origin: BASE,
        referer: loginPageUrl,
        ...(jar.size ? { cookie: cookieHeader(jar) } : {}),
      },
      body: form.toString(),
    });
    mergeCookies(jar, login);
    base.loginStatus = login.status;
    const loginLoc = safePath(login.headers.get("location") ?? "");
    base.loginRedirect = loginLoc || null;
    trace.push(
      `POST /j_spring_security_check ${login.status}${loginLoc ? ` → ${loginLoc}` : ""} (${jar.size} cookie(s))`,
    );


    // 4) Suivre jusqu'à 3 redirections GET avec le même cookie jar.
    const afterLogin = await followRedirects(login, jar, trace, loginPageUrl);

    const loginPathChain = [loginLoc, ...afterLogin.hops].filter(Boolean);
    const reachedMain = loginPathChain.some((p) => /mainMenu\.html/i.test(p));
    const bouncedToLogin =
      loginPathChain.some(isLoginPath) ||
      (afterLogin.html.length > 0 && looksLikeLoginPage(afterLogin.html));

    if (!reachedMain && bouncedToLogin) {
      return done({
        outcome: "auth_refused",
        message: `Identifiants refusés par IXELLIO (redirection finale : ${
          loginPathChain[loginPathChain.length - 1] ?? "inconnue"
        }).`,
      });
    }

    if (login.status >= 400) {
      return done({
        outcome: "unexpected_response",
        message: `Réponse inattendue du serveur IXELLIO lors du login (HTTP ${login.status}).`,
      });
    }

    if (!reachedMain && afterLogin.html.length === 0 && afterLogin.status >= 300) {
      return done({
        outcome: "unexpected_response",
        message: `Login : chaîne de redirection non résolue (HTTP ${afterLogin.status}, dernier chemin ${
          afterLogin.finalPath || "inconnu"
        }).`,
      });
    }

    // 5) Recherche par immatriculation dans la même session.
    const search = await fetch(SEARCH_URL, {
      method: "POST",
      redirect: "manual",
      headers: {
        ...BROWSER_HEADERS,
        "content-type": "application/x-www-form-urlencoded",
        origin: BASE,
        referer: `${BASE}/mainMenu.html?method=index`,
        ...(jar.size ? { cookie: cookieHeader(jar) } : {}),
      },
      body: new URLSearchParams({ immat: input.plate }).toString(),
    });

    mergeCookies(jar, search);
    base.searchStatus = search.status;
    const searchLoc = safePath(search.headers.get("location") ?? "");
    base.searchRedirect = searchLoc || null;
    trace.push(`POST /ident.html?method=searchByImmat ${search.status}${searchLoc ? ` → ${searchLoc}` : ""}`);

    const afterSearch = await followRedirects(search, jar, trace, `${BASE}/mainMenu.html?method=index`);
    const searchChain = [searchLoc, ...afterSearch.hops].filter(Boolean);
    const html = afterSearch.html;
    base.bytes = html.length;

    const backToLogin = searchChain.some(isLoginPath) || (html.length > 0 && looksLikeLoginPage(html));
    if (backToLogin) {
      return done({
        searchRedirect: base.searchRedirect,
        outcome: "redirect_to_login",
        message: `La session n'a pas été conservée : retour à l'authentification (${
          searchChain[searchChain.length - 1] ?? "page de connexion"
        }).`,
      });
    }

    if (html.length === 0) {
      return done({
        authenticated: reachedMain,
        outcome: "unexpected_response",
        message: `Recherche : aucune page finale exploitable (HTTP ${afterSearch.status}, dernier chemin ${
          afterSearch.finalPath || searchLoc || "inconnu"
        }).`,
      });
    }

    const parsed = parseIxellioHtml(html);
    const vehicle = parsed.vehicle;
    const found = parsed.fieldCount > 0;
    trace.push(
      `parsing : ${parsed.pairCount} couple(s) libellé/valeur, ${parsed.fieldCount} champ(s) reconnu(s)` +
        (parsed.detectedFields.length ? ` (${parsed.detectedFields.join(", ")})` : ""),
    );
    if (parsed.isVersionList) trace.push(`page de choix de version détectée (${parsed.versionCount} options)`);

    return done({
      authenticated: true,
      vehicle,
      detectedFields: parsed.detectedFields,
      fieldCount: parsed.fieldCount,
      pairCount: parsed.pairCount,
      isVersionList: parsed.isVersionList,
      bytes: html.length,
      outcome: found ? "auth_ok_vehicle_found" : "auth_ok_no_vehicle",
      message: parsed.isVersionList
        ? "IXELLIO a renvoyé une liste de versions : sélection manuelle nécessaire, aucune fiche unique exploitable."
        : parsed.fieldCount > 1
          ? "Connexion réussie et véhicule identifié."
          : found
            ? "IXELLIO a répondu mais l'extraction des détails est incomplète."
            : "Connexion réussie, mais aucune donnée véhicule exploitable pour cette plaque de test.",
    });
  } catch (e) {
    return done({
      outcome: "network_error",
      message: `Erreur réseau côté serveur : ${e instanceof Error ? e.message : "inconnue"}`,
    });
  }
}
