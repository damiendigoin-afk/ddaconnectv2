/**
 * Districash — éléments purs (sans réseau) partagés client/serveur.
 *
 * État réel (15/10/2026) : connexion serveur validée pour les deux comptes
 * (Castillon 19025, Lalinde 60669) — authentification formulaire + recherche
 * POST https://districashv2.inoshop.net/search en lecture seule, 20 pneus
 * 245/45 R20 lus avec EAN et prix. Le parseur ci-dessous alimente les devis
 * (lignes J/J+ avec prix uniquement). Lecture seule : jamais de commande,
 * jamais d'appel à /rest/xat2v2 (endpoint non documenté, potentiellement transactionnel).
 */
import { computeStatus, type IntegrationStatus, type StatusInput } from "./integration-status";

/** Comptes Districash par site (codes site de la table sites). */
export const DISTRICASH_ACCOUNTS: Record<string, string> = {
  castillon: "19025",
  dda: "60669", // Lalinde
};

export const DISTRICASH_PROVIDER_PREFIX = "districash:";
export const districashProvider = (siteId: string) => `${DISTRICASH_PROVIDER_PREFIX}${siteId}`;

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
  return m ? decode(m[1] ?? "").trim() : null;
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
    const open = m[1] ?? "";
    const inner = m[2] ?? "";
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

/* --------------------------- Offres pour le devis -------------------------- */

/** Dimension et indices lus dans le libellé (ex. « … 245/45R20 103V XL »). */
export function parseDistricashLabel(label: string): { size: string | null; load: string | null; speed: string | null } {
  const m = /(\d{3})\s*\/\s*(\d{2})\s*Z?R\s*(\d{2})(?:C)?\s+(\d{2,3}(?:\/\d{2,3})?)\s*([A-Z])\b/i.exec(label);
  if (m) return { size: `${m[1]}/${m[2]}R${m[3]}`, load: m[4]!, speed: m[5]!.toUpperCase() };
  const s = /(\d{3})\s*\/\s*(\d{2})\s*Z?R\s*(\d{2})/i.exec(label);
  return { size: s ? `${s[1]}/${s[2]}R${s[3]}` : null, load: null, speed: null };
}

/** Saison uniquement si le libellé l'indique clairement ; sinon null (jamais devinée). */
export function districashSeason(label: string): "ete" | "quatre_saisons" | "hiver" | null {
  const l = ` ${label.toUpperCase()} `;
  if (/\b(4S\d?|4 ?SEASONS?|ALL ?SEASONS?|CROSSCLIMATE|QUATRAC|4X4 ?SEASON|ALLSEASON|MULTISEASON)\b/.test(l)) return "quatre_saisons";
  if (/\b(WINTER|HIVER|ALPIN|WINTRAC|SNOW|ICE|NORDIC|W\d{3})\b/.test(l)) return "hiver";
  if (/\b(SUMMER|ETE|PRIMACY|PILOT SPORT|ECOCONTACT|PREMIUMCONTACT|SPORTCONTACT|VENTUS|TURANZA|POTENZA|EAGLE F1|EFFICIENTGRIP)\b/.test(l)) return "ete";
  return null;
}

/**
 * Lignes Districash J/J+ -> offres du moteur existant. Le prix d'achat est
 * `data-filtreprixachat` (prix d'achat HT affiché par le portail), traité
 * comme tel : la marge MAX(PA × %, minimum) et le montage sont appliqués par le moteur.
 */
export function districashRowsToOffers(
  rows: DistricashRow[],
  tierOf: (brand: string) => string | null,
  consultedAt: string,
) {
  return quotableDistricashRows(rows).map((r) => {
    const d = parseDistricashLabel(r.label);
    const brand = r.brand.trim().toUpperCase();
    return {
      id: `districash:${r.code || r.ean}`,
      tier: tierOf(brand) ?? "",
      season: districashSeason(r.label) ?? "",
      is3pmsf: /3PMSF|\bM\+S\b.*\bSNOW/i.test(r.label),
      brand,
      model: r.label,
      size: d.size,
      purchase_price_ht: r.purchaseHt,
      price_kind: "purchase_ht",
      mount_price_ttc: 0,
      source: "Districash (prix d'achat portail)",
      source_url: null,
      product_url: null,
      price_date: consultedAt.slice(0, 10),
      active: true,
      created_at: consultedAt,
      updated_at: consultedAt,
      load_index: d.load,
      speed_index: d.speed,
      availability: r.availability === "J+" ? "Disponible J+" : "Disponible J",
      supplier_ref: r.code || r.ean,
      supplier_key: "districash",
    };
  });
}
