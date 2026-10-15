/**
 * Districash — éléments purs (sans réseau) partagés client/serveur.
 *
 * État réel (15/10/2026) : la recherche Districash n'a été observée que dans une
 * session Chrome authentifiée (POST https://districashv2.inoshop.net/search).
 * L'authentification automatique n'est ni documentée ni autorisée : aucun
 * connecteur n'interroge Districash. Le parseur ci-dessous est prêt pour le jour
 * où un accès serveur sera validé, et n'est appelé que par les tests.
 * Jamais d'appel à /rest/xat2v2 (endpoint non documenté, potentiellement transactionnel).
 */
import { computeStatus, type IntegrationStatus, type StatusInput } from "./integration-status";

/** Comptes Districash par site (codes site de la table sites). */
export const DISTRICASH_ACCOUNTS: Record<string, string> = {
  castillon: "19025",
  dda: "60669", // Lalinde
};

export const DISTRICASH_PROVIDER_PREFIX = "districash:";
export const districashProvider = (siteId: string) => `${DISTRICASH_PROVIDER_PREFIX}${siteId}`;

/** Message affiché tant que la connexion automatique n'est pas démontrée. */
export const DISTRICASH_BLOCKED =
  "Connexion automatique non validée : le mode d'authentification du portail Districash n'est pas documenté. Aucune donnée Districash n'est consultée en temps réel.";

export const DISTRICASH_STATUS_LABEL: Record<IntegrationStatus, string> = {
  non_configure: "Non configuré",
  configure: "Identifiants enregistrés — connexion non validée",
  teste: "Connecté",
  actif: "Connecté",
  erreur: "Échec",
};

export function districashStatus(input: StatusInput): IntegrationStatus {
  return computeStatus({ ...input, active: true });
}

/* ------------------------------- Parseur HTML ------------------------------ */

export type DistricashAvailability = "J" | "J+" | "indisponible" | "inconnu";

export type DistricashRow = {
  brand: string;
  label: string;
  code: string;
  ean: string | null;
  purchaseHt: number | null;
  availability: DistricashAvailability;
};

/** Nom d'image de la pastille verte J+ observée. */
export const DISTRICASH_JPLUS_IMAGE = "H0kz82D2C3jk4sZV6zzvPWCWa8xHYoa7J9xixKPQ.png";

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag);
  return m ? decode(m[1]).trim() : null;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parsePrice(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function availabilityOf(rowHtml: string, dispoType: string | null): DistricashAvailability {
  const t = (dispoType ?? "").trim().toUpperCase();
  if (rowHtml.includes(DISTRICASH_JPLUS_IMAGE) || t === "J+") return "J+";
  if (t === "J") return "J";
  if (/rouge\.png/i.test(rowHtml)) return "indisponible";
  return "inconnu";
}

/** Lit les lignes produits principales (tr.ARTICLE.ARTICLE_CONTENT) ; ignore les lignes auxiliaires à 1 td. */
export function parseDistricashSearch(html: string): DistricashRow[] {
  const rows: DistricashRow[] = [];
  const re = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const open = m[1];
    const inner = m[2];
    const cls = attr(open, "class") ?? "";
    if (!/\bARTICLE\b/.test(cls) || !/\bARTICLE_CONTENT\b/.test(cls)) continue;
    if ((inner.match(/<td\b/gi) ?? []).length <= 1) continue;
    rows.push({
      brand: attr(open, "data-filtremarques") ?? "",
      label: attr(open, "data-filtrelibelle") ?? "",
      code: attr(open, "data-filtrecodearticle") ?? "",
      ean: attr(open, "data-ean"),
      purchaseHt: parsePrice(attr(open, "data-filtreprixachat")),
      availability: availabilityOf(inner, attr(open, "data-dispo-type")),
    });
  }
  return rows;
}

/** Seuls les pneus à statut positif (J ou J+, pastille verte) et avec prix sont proposables. */
export function quotableDistricashRows(rows: DistricashRow[]): DistricashRow[] {
  return rows.filter((r) => (r.availability === "J" || r.availability === "J+") && r.purchaseHt != null);
}
