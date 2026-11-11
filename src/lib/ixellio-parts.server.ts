/**
 * Consultation catalogue IXELLIO par référence — LECTURE SEULE, diagnostic manager.
 * Réutilise les identifiants chiffrés et openIxellioSession (un seul login, pas de boucle).
 * Jamais renvoyé : identifiants, cookies, jetons, HTML brut.
 */
import { inventoryEuroAmounts, type EuroInventory } from "./ixellio-parts-amounts";
import { inspectReplaceControls, type ReplaceDiag } from "./ixellio-parts-replace";
import { groupIxellioResults, groupingToParts, type IxellioGrouping } from "./ixellio-parts-results";
import { loadIxellioCredentials } from "./ixellio-store.server";
import { openIxellioSession } from "./ixellio.server";
import { acquireIxellio, releaseIxellio } from "./ixellio-lock.server";
import { inspectForms, inspectPageFormHints, inspectStructure, inspectTargeted, type PageFormHints, type TargetedDiag, parseIxellioParts, type FormShape, type IxellioPartsResult, type StructureShape } from "./ixellio-parts-parse";

const BASE = "https://www.ixellio.fr";
const PAGE_URL = `${BASE}/PieceRecherche.html`;
const SEARCH_URL = `${BASE}/PieceRecherche.html?method=searchReference`;

const HEADERS: Record<string, string> = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "fr-FR,fr;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

export type IxellioPartsLookup = {
  status: "ok" | "no_result" | "structure_non_reconnue" | "not_configured" | "auth_failed" | "session_lost" | "busy" | "rate_limited" | "http_error" | "network_error";
  message: string;
  reference: string;
  trace: string[];
  diagnostic: {
    csrfFound: boolean;
    formFieldNames: string[];
    searchStatus: number | null;
    bytes: number;
    tableCount: number;
    headers: string[][];
    /** Formes des formulaires de la page de recherche (aucune valeur). */
    pageForms: FormShape[];
    /** Structure de la réponse POST (aucun HTML brut). */
    response: StructureShape | null;
    pageHints: PageFormHints | null;
    targeted: TargetedDiag | null;
    euros: EuroInventory | null;
    grouping: IxellioGrouping | null;
    replace: ReplaceDiag | null;
  };
  result: Omit<IxellioPartsResult, "headers" | "tableCount"> | null;
  durationMs: number;
};

const jarHeader = (jar: Map<string, string>) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

function mergeCookies(jar: Map<string, string>, res: Response) {
  const h = res.headers as unknown as { getSetCookie?: () => string[] };
  const raw = typeof h.getSetCookie === "function" ? h.getSetCookie() : [res.headers.get("set-cookie") ?? ""];
  for (const line of raw.filter(Boolean)) {
    const first = line.split(";")[0] ?? "";
    const eq = first.indexOf("=");
    if (eq > 0) jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
  }
}

/** Jeton _csrf : formulaire contenant « searchReference » d'abord, sinon premier _csrf. */
export function extractPartsCsrf(html: string): string | null {
  const form = /<form[^>]*searchReference[^>]*>([\s\S]*?)<\/form>/i.exec(html)?.[1];
  for (const scope of [form, html]) {
    if (!scope) continue;
    const tag = /<input\b[^>]*name=["']_csrf["'][^>]*>/i.exec(scope)?.[0];
    const v = tag ? /value=["']([^"']+)["']/i.exec(tag)?.[1] : null;
    if (v) return v;
  }
  return null;
}

/** Noms des champs du formulaire de recherche (jamais les valeurs). */
export function partsFormFieldNames(html: string): string[] {
  const form = /<form[^>]*searchReference[^>]*>([\s\S]*?)<\/form>/i.exec(html)?.[1] ?? "";
  const names = new Set<string>();
  for (const m of form.matchAll(/<(?:input|select|textarea)\b[^>]*name=["']([^"']+)["']/gi)) names.add(m[1]!);
  return [...names];
}

export function buildPartsSearchBody(reference: string, csrf: string | null): string {
  const body = new URLSearchParams({ reference });
  if (csrf) body.set("_csrf", csrf);
  return body.toString();
}

/** HTTP 200 sans ligne ni mention explicite d'absence n'est jamais un « ok ». */
export function partsOutcome(count: number, noResult: boolean): [IxellioPartsLookup["status"], string] {
  if (count > 0) return ["ok", `${count} ligne(s) lue(s).`];
  if (noResult) return ["no_result", "IXELLIO indique explicitement aucun résultat."];
  return ["structure_non_reconnue", "Réponse HTTP 200 sans ligne reconnue ni mention d'absence : recherche NON validée, structure à relever."];
}

export async function lookupIxellioPartsByReference(reference: string): Promise<IxellioPartsLookup> {
  const started = Date.now();
  const trace: string[] = [];
  const diagnostic: IxellioPartsLookup["diagnostic"] = {
    csrfFound: false,
    formFieldNames: [],
    searchStatus: null,
    bytes: 0,
    tableCount: 0,
    headers: [],
    pageForms: [],
    response: null,
    pageHints: null,
    targeted: null,
    euros: null,
    grouping: null,
    replace: null,
  };
  const out = (status: IxellioPartsLookup["status"], message: string, result: IxellioPartsLookup["result"] = null): IxellioPartsLookup => ({
    status, message, reference, trace, diagnostic, result, durationMs: Date.now() - started,
  });

  const creds = await loadIxellioCredentials();
  if (!creds) return out("not_configured", "IXELLIO n'est pas configuré dans Paramètres API.");
  const lock = acquireIxellio();
  if (!lock.ok)
    return lock.reason === "busy"
      ? out("busy", "Une consultation IXELLIO est déjà en cours (licence mono-session).")
      : out("rate_limited", "Patientez quelques secondes entre deux consultations IXELLIO.");
  try {
    // Un seul login, pas de seconde tentative ici (évite de déloger le garage).
    const session = await openIxellioSession(creds, trace);
    if (!session.ok) return out("auth_failed", session.message);
    const jar = session.jar;

    const page = await fetch(PAGE_URL, {
      redirect: "manual",
      headers: { ...HEADERS, referer: `${BASE}/mainMenu.html?method=index`, cookie: jarHeader(jar) },
    });
    mergeCookies(jar, page);
    const pageHtml = page.status === 200 ? await page.text() : (await page.text(), "");
    trace.push(`GET /PieceRecherche.html ${page.status} (${pageHtml.length} o)`);
    const csrf = extractPartsCsrf(pageHtml) ?? extractPartsCsrf(session.html);
    diagnostic.csrfFound = Boolean(csrf);
    diagnostic.formFieldNames = partsFormFieldNames(pageHtml);
    diagnostic.pageForms = inspectForms(pageHtml);
    diagnostic.pageHints = inspectPageFormHints(pageHtml);
    trace.push(csrf ? "jeton _csrf détecté" : "jeton _csrf absent");

    const search = await fetch(SEARCH_URL, {
      method: "POST",
      redirect: "manual",
      headers: {
        ...HEADERS,
        "content-type": "application/x-www-form-urlencoded",
        origin: BASE,
        referer: PAGE_URL,
        cookie: jarHeader(jar),
      },
      body: buildPartsSearchBody(reference, csrf),
    });
    diagnostic.searchStatus = search.status;
    const html = await search.text();
    diagnostic.bytes = html.length;
    trace.push(`POST /PieceRecherche.html?method=searchReference ${search.status} (${html.length} o)`);

    if (search.status >= 300 && search.status < 400)
      return out("session_lost", "IXELLIO a redirigé la recherche (session non conservée ou méthode refusée).");
    if (search.status !== 200) return out("http_error", `IXELLIO a répondu HTTP ${search.status}.`);

    diagnostic.response = inspectStructure(html, reference);
    diagnostic.targeted = inspectTargeted(html, reference);
    diagnostic.euros = inventoryEuroAmounts(html, reference);
    diagnostic.grouping = groupIxellioResults(html, reference);
    diagnostic.replace = inspectReplaceControls(html, reference);
    const parsed = parseIxellioParts(html, reference);
    diagnostic.tableCount = parsed.tableCount;
    diagnostic.headers = parsed.headers;
    if (parsed.isLoginPage) return out("session_lost", "Retour à la page de connexion IXELLIO.");
    const { headers: _h, tableCount: _t, ...result } = parsed;
    // Repli : groupement structurel exclusif et complet (conditions dans groupingToParts).
    const grouped = !parsed.parts.length ? groupingToParts(diagnostic.grouping, reference) : null;
    if (grouped) {
      const unverified = diagnostic.grouping.results.length - diagnostic.grouping.categoriesVerified;
      return out("ok", `${grouped.length} résultat(s) exact(s) groupé(s) · prix public constructeur HT (pas un prix d'achat)${unverified ? ` · ${unverified} catégorie(s) non vérifiée(s)` : ""} · conversion devis bloquée.`, { ...result, parts: grouped });
    }
    return out(...partsOutcome(parsed.parts.length, parsed.noResult), result);
  } catch (e) {
    return out("network_error", `Erreur réseau : ${e instanceof Error ? e.message : "inconnue"}`);
  } finally {
    releaseIxellio();
  }
}
