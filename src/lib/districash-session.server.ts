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

export type Jar = Map<string, string>;

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

async function req(jar: Jar, path: string, init: RequestInit = {}, check: (p: string) => string = assertSafe) {
  const url = check(path);
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
  const s = await openDistricashSession(username, password);
  const { jar, steps } = s;
  const out = (blocker: string | null, authenticated = false, rows: DistricashRow[] = []) => ({ authenticated, steps, blocker, rows });
  if (s.blocker || !s.token) return out(s.blocker ?? "Session non ouverte.");
  const token2 = s.token;

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
    const title = /<title>([^<]{0,120})<\/title>/i.exec(sHtml)?.[1]?.trim() ?? "sans titre";
    steps.push({ step: "POST /search", status: search.status, note: `HTML ${sHtml.length} car., titre « ${title} »` });
  }
  const rows = parseDistricashSearch(sHtml);
  const proven = rows.some((r) => r.ean && r.purchaseHt != null);
  if (!proven) return out("Session ouverte mais catalogue sans produit avec prix et EAN : non validé.", false, rows);
  return out(null, true, rows);
}


/** Ouvre une session (tentative unique). Renvoie le jar en mémoire, jamais exposé au client. */
export async function openDistricashSession(username: string, password: string): Promise<{ jar: Jar; steps: DistricashLoginStep[]; blocker: string | null; token: string | null }> {
  const jar: Jar = new Map();
  const steps: DistricashLoginStep[] = [];
  const fail = (blocker: string) => ({ jar, steps, blocker, token: null });
  const page = await req(jar, "/login");
  const html = await page.text();
  steps.push({ step: "GET /login", status: page.status, note: "formulaire public" });
  if (/recaptcha|hcaptcha|turnstile|captcha/i.test(html)) return fail("Captcha présent : arrêt.");
  const token = csrf(html);
  if (!token) return fail("Jeton CSRF introuvable sur le formulaire.");

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
      note += ` ; réponse JSON clés=[${Object.keys(j).join(",")}], type=${String(j["type"] ?? "")}`;
      if (typeof j["redirection"] === "string" && j["redirection"]) {
        try {
          note += `, redirection=${new URL(j["redirection"], BASE).pathname}`;
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }
  if (/otp|2fa|double authentification|code de vérification/i.test(loginText)) {
    steps.push({ step: "POST /login", status: login.status, note });
    return fail("Second facteur demandé : arrêt.");
  }
  steps.push({ step: "POST /login", status: login.status, note });
  if (login.status === 419) return fail("Jeton CSRF refusé (HTTP 419).");
  if (login.status === 422 || login.status === 401) return fail("Identifiants refusés par le portail.");
  if (login.status === 429) return fail("Limitation du portail (HTTP 429) : arrêt.");

  // Preuve de session : la page d'accueil ne doit plus renvoyer vers /login.
  const home = await req(jar, "/");
  const homeHtml = await home.text();
  const homeLoc = home.headers.get("location");
  const loggedOut = (homeLoc && /\/login/.test(homeLoc)) || /name="password"/.test(homeHtml);
  steps.push({ step: "GET /", status: home.status, note: loggedOut ? "toujours déconnecté" : "page connectée" });
  if (loggedOut) return fail("Session non ouverte (le portail renvoie vers la connexion).");
  return { jar, steps, blocker: null, token: csrf(homeHtml) ?? token };

}

/** Corps exact de POST /search (format formulaire observé dans Chrome). */
export function districashSearchBody(token: string, tyre: DistricashTyre, quantity: number): URLSearchParams {
  return new URLSearchParams({
    _token: token,
    reference_input: "[]",
    tyre_inputs: JSON.stringify({
      pneu_larg: tyre.width,
      pneu_haut: tyre.height,
      pneu_diam: tyre.diameter,
      pneu_indc: tyre.load ?? "",
      pneu_indv: tyre.speed ?? "",
    }),
    quantite: String(quantity),
    user_filters: JSON.stringify({ search_type: "recherche_standard" }),
    searchTypeDefaut: "recherche_standard",
    searchTypageCde: "",
  });
}

/** Message honnête et précis d'un test (aucun « connecté » sur un simple 302). */
export function summarizeDistricashTest(r: DistricashSessionResult): { ok: boolean | null; message: string } {
  const loginOk = r.steps.some((s) => s.step === "GET /" && s.note === "page connectée");
  const search = r.steps.find((s) => s.step === "POST /search");
  const priced = r.rows.filter((x) => x.ean && x.purchaseHt != null).length;
  if (r.authenticated)
    return { ok: true, message: `Authentification et catalogue validés : ${priced} pneu(s) 245/45 R20 avec EAN et prix.` };
  if (!loginOk) return { ok: false, message: `Authentification échouée : ${r.blocker ?? "raison inconnue"}` };
  if (!search) return { ok: false, message: `Authentification confirmée ; recherche catalogue non effectuée.` };
  return {
    ok: false,
    message: `Authentification confirmée ; recherche catalogue 245/45 R20 échouée (HTTP ${search.status ?? "?"}, ${r.rows.length} ligne(s) lue(s), ${priced} avec EAN et prix).`,
  };
}

// ---------------------------------------------------------------------------
// Ajout au panier (mutation de panier UNIQUEMENT, jamais de commande).
// Seuls GET /cart, GET /catalog/product/... et POST /cart/store sont permis.
const CART_FORBIDDEN = /(xat2v2|\/rest\/|\/cart\/order|\/cart\/payment|\/order|checkout|payment|validate)/i;
export function assertCartPath(path: string, method: string): string {
  const u = new URL(path, BASE);
  if (u.protocol !== "https:" || u.host !== DISTRICASH_HOST) throw new Error("Hôte non autorisé.");
  if (CART_FORBIDDEN.test(u.pathname)) throw new Error("Chemin interdit.");
  const ok =
    (method === "GET" && (u.pathname === "/cart" || /^\/catalog\/product\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(u.pathname))) ||
    (method === "POST" && u.pathname === "/cart/store");
  if (!ok) throw new Error("Chemin non autorisé.");
  return u.toString();
}

export async function cartRequest(jar: Jar, path: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const method = (init.method ?? "GET").toUpperCase();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20000);
  try {
    return await req(jar, path, { ...init, signal: ctrl.signal }, (p) => assertCartPath(p, method));
  } finally {
    clearTimeout(t);
  }
}
export { csrf as districashCsrf };
