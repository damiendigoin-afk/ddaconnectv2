/**
 * Test d'authentification IXELLIO côté serveur.
 *
 * Règles de sécurité strictes :
 *  - les identifiants ne sont JAMAIS journalisés, persistés ni renvoyés au client ;
 *  - les cookies de session (Set-Cookie) restent en mémoire du serveur le temps
 *    de la requête et ne sont jamais exposés ;
 *  - seules des données non sensibles (statut, durée, champs véhicule) sortent.
 */

const BASE = "https://www.ixellio.fr";
const LOGIN_URL = `${BASE}/j_spring_security_check`;
const SEARCH_URL = `${BASE}/ident.html?method=searchByImmat`;

export type IxellioTestOutcome =
  | "auth_ok_vehicle_found"
  | "auth_ok_no_vehicle"
  | "auth_refused"
  | "redirect_to_login"
  | "network_error"
  | "unexpected_response";

export type IxellioVehicle = {
  marque?: string;
  modele?: string;
  version?: string;
  vin?: string;
  codeMoteur?: string;
  dateMec?: string;
};

export type IxellioTestResult = {
  outcome: IxellioTestOutcome;
  authenticated: boolean;
  loginStatus: number | null;
  searchStatus: number | null;
  durationMs: number;
  bytes: number;
  vehicle: IxellioVehicle;
  message: string;
};

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

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extraction best-effort des champs véhicule, sans dépendance à une structure figée. */
function parseVehicle(html: string): IxellioVehicle {
  const text = stripTags(html);
  const v: IxellioVehicle = {};

  const grab = (labels: string[], max = 60): string | undefined => {
    for (const label of labels) {
      const re = new RegExp(`${label}\\s*:?\\s*([^:]{2,${max}}?)(?=\\s{2,}|\\s[A-ZÉÈ][a-zéèêà]+\\s*:|$)`, "i");
      const m = re.exec(text);
      const val = m?.[1]?.trim();
      if (val && val.length > 1) return val;
    }
    return undefined;
  };

  const vin = /\b[A-HJ-NPR-Z0-9]{17}\b/.exec(text)?.[0];
  if (vin) v.vin = vin;

  const marque = grab(["Marque", "Constructeur"]);
  if (marque) v.marque = marque;
  const modele = grab(["Mod[eè]le"]);
  if (modele) v.modele = modele;
  const version = grab(["Version", "Finition"]);
  if (version) v.version = version;
  const codeMoteur = grab(["Code moteur", "Type moteur"], 30);
  if (codeMoteur) v.codeMoteur = codeMoteur;

  const mec = grab(["Date de 1re mise en circulation", "1re mise en circulation", "Date MEC", "Mise en circulation"], 20);
  const mecDate = mec ? /\d{2}[/-]\d{2}[/-]\d{2,4}/.exec(mec)?.[0] : undefined;
  if (mecDate) v.dateMec = mecDate;

  return v;
}

function looksLikeLogin(html: string): boolean {
  const l = html.toLowerCase();
  return (
    l.includes("j_username") ||
    l.includes("j_password") ||
    l.includes("mot de passe") ||
    l.includes("identifiant") ||
    l.includes("authentification")
  );
}

export async function runIxellioAuthTest(input: {
  username: string;
  password: string;
  plate: string;
}): Promise<IxellioTestResult> {
  const started = Date.now();
  const jar = new Map<string, string>();
  const base: IxellioTestResult = {
    outcome: "unexpected_response",
    authenticated: false,
    loginStatus: null,
    searchStatus: null,
    durationMs: 0,
    bytes: 0,
    vehicle: {},
    message: "",
  };

  try {
    // 1) Récupération d'une session anonyme (JSESSIONID) avant le login.
    try {
      const seed = await fetch(`${BASE}/`, { redirect: "manual" });
      mergeCookies(jar, seed);
      await seed.text();
    } catch {
      /* non bloquant */
    }

    // 2) Authentification.
    const body = new URLSearchParams({
      j_username: input.username,
      j_password: input.password,
    }).toString();

    const login = await fetch(LOGIN_URL, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(jar.size ? { cookie: cookieHeader(jar) } : {}),
      },
      body,
    });
    mergeCookies(jar, login);
    const loginBody = await login.text();
    const location = login.headers.get("location") ?? "";
    base.loginStatus = login.status;

    const failedLogin =
      /error|login|authentification|denied/i.test(location) ||
      (login.status === 200 && looksLikeLogin(loginBody));

    if (failedLogin) {
      return {
        ...base,
        outcome: "auth_refused",
        durationMs: Date.now() - started,
        message: "Identifiants refusés par IXELLIO (retour vers la page de connexion).",
      };
    }

    if (login.status >= 400) {
      return {
        ...base,
        outcome: "unexpected_response",
        durationMs: Date.now() - started,
        message: `Réponse inattendue du serveur IXELLIO lors du login (HTTP ${login.status}).`,
      };
    }

    // 3) Recherche par immatriculation dans la même session.
    const search = await fetch(SEARCH_URL, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(jar.size ? { cookie: cookieHeader(jar) } : {}),
      },
      body: new URLSearchParams({ immat: input.plate }).toString(),
    });
    mergeCookies(jar, search);
    const html = await search.text();
    base.searchStatus = search.status;
    base.bytes = html.length;

    if (search.status >= 300 && search.status < 400) {
      const loc = search.headers.get("location") ?? "";
      if (/login|ident|auth/i.test(loc) || loc === "") {
        return {
          ...base,
          outcome: "redirect_to_login",
          durationMs: Date.now() - started,
          message: "La session n'a pas été conservée : IXELLIO redirige vers l'authentification.",
        };
      }
      return {
        ...base,
        outcome: "unexpected_response",
        durationMs: Date.now() - started,
        message: `Redirection inattendue après la recherche (HTTP ${search.status}).`,
      };
    }

    if (looksLikeLogin(html) && !/carte grise|code moteur|vin/i.test(html)) {
      return {
        ...base,
        outcome: "redirect_to_login",
        durationMs: Date.now() - started,
        message: "Page de connexion renvoyée : la session serveur n'est pas authentifiée.",
      };
    }

    const vehicle = parseVehicle(html);
    const found = Boolean(vehicle.vin ?? vehicle.marque ?? vehicle.codeMoteur ?? vehicle.modele);

    return {
      ...base,
      authenticated: true,
      vehicle,
      outcome: found ? "auth_ok_vehicle_found" : "auth_ok_no_vehicle",
      durationMs: Date.now() - started,
      message: found
        ? "Connexion réussie et véhicule identifié."
        : "Connexion réussie, mais aucune donnée véhicule exploitable pour cette plaque de test.",
    };
  } catch (e) {
    return {
      ...base,
      outcome: "network_error",
      durationMs: Date.now() - started,
      message: `Erreur réseau côté serveur : ${e instanceof Error ? e.message : "inconnue"}`,
    };
  }
}
