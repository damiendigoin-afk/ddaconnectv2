/**
 * Session Districash côté serveur (lecture seule), sans navigateur.
 * - Hôte unique autorisé : districashv2.inoshop.net (identifiants jamais envoyés ailleurs).
 * - Une seule tentative de connexion par appel ; aucune relance automatique.
 * - Chemins autorisés : /login (GET/POST), /search, page d'accueil. Tout chemin
 *   transactionnel (/rest/xat2v2, cart, checkout, estimate, order…) est refusé.
 * - Ne renvoie ni cookies, ni jetons, ni identifiants ; uniquement des statuts.
 */
import { parseDistricashSearch, type DistricashRow } from "./districash";

export const DISTRICASH_HOST = "districashv2.inoshop.net";
const BASE = `https://${DISTRICASH_HOST}`;
const FORBIDDEN = /(xat2v2|\/rest\/|cart|panier|checkout|estimate|devis|order|commande|basket)/i;
const ALLOWED_PATHS = new Set(["/", "/login", "/search"]);
const UA = "DDA-Connect/1.0 (lecture tarifs, compte client)";

type Jar = Map<string, string>;

function assertSafe(path: string) {
  const u = new URL(path, BASE);
  if (u.host !== DISTRICASH_HOST) throw new Error("Hôte non autorisé.");
  if (FORBIDDEN.test(u.pathname) || !ALLOWED_PATHS.has(u.pathname)) throw new Error("Chemin non autorisé.");
  return u.toString();
}

function storeCookies(jar: Jar, res: Response) {
  const list = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const c of list) {
    const [pair] = c.split(";");
    const i = pair?.indexOf("=") ?? -1;
    if (pair && i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

const cookieHeader = (jar: Jar) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

async function req(jar: Jar, path: string, init: RequestInit = {}) {
  const url = assertSafe(path);
  const res = await fetch(url, {
    ...init,
    redirect: "manual",
    headers: { "User-Agent": UA, Cookie: cookieHeader(jar), ...(init.headers ?? {}) },
  });
  storeCookies(jar, res);
  return res;
}

function csrf(html: string): string | null {
  return (
    /name="_token"\s+value="([^"]+)"/.exec(html)?.[1] ??
    /<meta\s+name="csrf-token"\s+content="([^"]+)"/.exec(html)?.[1] ??
    null
  );
}

export type DistricashLoginStep = { step: string; status: number | null; note: string };

export type DistricashSessionResult = {
  authenticated: boolean;
  steps: DistricashLoginStep[];
  blocker: string | null;
  rows: DistricashRow[];
};

export type DistricashTyre = { width: string; height: string; diameter: string; load?: string; speed?: string };

/** Une tentative de connexion, puis une recherche catalogue si la session est prouvée. */
export async function districashLoginAndSearch(
  username: string,
  password: string,
  tyre: DistricashTyre,
  quantity = 1,
): Promise<DistricashSessionResult> {
  const jar: Jar = new Map();
  const steps: DistricashLoginStep[] = [];
  const out = (blocker: string | null, authenticated = false, rows: DistricashRow[] = []) => ({
    authenticated,
    steps,
    blocker,
    rows,
  });

  const page = await req(jar, "/login");
  const html = await page.text();
  steps.push({ step: "GET /login", status: page.status, note: "formulaire public" });
  if (/recaptcha|hcaptcha|turnstile|captcha/i.test(html)) return out("Captcha présent : arrêt.");
  const token = csrf(html);
  if (!token) return out("Jeton CSRF introuvable sur le formulaire.");

  // Tentative unique.
  const body = new URLSearchParams({ _token: token, login: username, password });
  const login = await req(jar, "/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json, text/html",
      "X-Requested-With": "XMLHttpRequest",
      Origin: BASE,
      Referer: `${BASE}/login`,
    },
    body,
  });
  const loginText = await login.text();
  const loc = login.headers.get("location");
  let note = loc ? `redirection vers ${new URL(loc, BASE).pathname}` : "pas de redirection";
  if (/json/i.test(login.headers.get("content-type") ?? "")) {
    try {
      const j = JSON.parse(loginText) as Record<string, unknown>;
      note += ` ; réponse JSON clés=[${Object.keys(j).join(",")}]`;
    } catch {
      /* ignore */
    }
  }
  if (/otp|2fa|double authentification|code de vérification/i.test(loginText)) {
    steps.push({ step: "POST /login", status: login.status, note });
    return out("Second facteur demandé : arrêt.");
  }
  steps.push({ step: "POST /login", status: login.status, note });
  if (login.status === 419) return out("Jeton CSRF refusé (HTTP 419).");
  if (login.status === 422 || login.status === 401) return out("Identifiants refusés par le portail.");
  if (login.status === 429) return out("Limitation du portail (HTTP 429) : arrêt.");

  // Preuve de session : la page d'accueil ne doit plus renvoyer vers /login.
  const home = await req(jar, "/");
  const homeHtml = await home.text();
  const homeLoc = home.headers.get("location");
  const loggedOut = (homeLoc && /\/login/.test(homeLoc)) || /name="password"/.test(homeHtml);
  steps.push({ step: "GET /", status: home.status, note: loggedOut ? "toujours déconnecté" : "page connectée" });
  if (loggedOut) return out("Session non ouverte (le portail renvoie vers la connexion).");
  const token2 = csrf(homeHtml) ?? token;

  // Protocole confirmé dans Chrome : formulaire urlencoded, champs imbriqués en JSON texte.
  const search = await req(jar, "/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html",
      "X-Requested-With": "XMLHttpRequest",
      Origin: BASE,
      Referer: `${BASE}/`,
    },
    body: districashSearchBody(token2, tyre, quantity),
  });
  let sHtml = await search.text();
  if (/json/i.test(search.headers.get("content-type") ?? "")) {
    try {
      const j = JSON.parse(sHtml) as Record<string, unknown>;
      const htmlField = Object.values(j).find((v) => typeof v === "string" && v.includes("ARTICLE_CONTENT"));
      sHtml = typeof htmlField === "string" ? htmlField : sHtml;
      steps.push({ step: "POST /search", status: search.status, note: `JSON clés=[${Object.keys(j).join(",")}]` });
    } catch {
      steps.push({ step: "POST /search", status: search.status, note: "JSON illisible" });
    }
  } else {
    steps.push({ step: "POST /search", status: search.status, note: `HTML ${sHtml.length} car.` });
  }
  const rows = parseDistricashSearch(sHtml);
  const proven = rows.some((r) => r.ean && r.purchaseHt != null);
  if (!proven) return out("Session ouverte mais catalogue sans produit avec prix et EAN : non validé.", false, rows);
  return out(null, true, rows);
}
