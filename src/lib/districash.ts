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
  /** Fiche produit exacte lue sur l'ancre de la ligne (jamais construite). */
  productUrl: string | null;
  /** Sous-famille portail (ex. « TOURISME ETE ») : saison déclarée par le distributeur. */
  family?: string | null;
  /** Gamme déclarée par le portail (attribut BUDGET / MEDIUM / PREMIUM), sinon null. */
  supplierTier?: "entree" | "milieu" | "haut" | null;
};

const SUPPLIER_TIER: Record<string, "entree" | "milieu" | "haut"> = { BUDGET: "entree", MEDIUM: "milieu", PREMIUM: "haut" };

/** Gamme portail : seul un attribut data-* valant exactement BUDGET/MEDIUM/PREMIUM fait foi (jamais déduite). */
export function districashSupplierTier(openTag: string): "entree" | "milieu" | "haut" | null {
  const re = /\bdata-[\w-]+\s*=\s*"\s*(BUDGET|MEDIUM|PREMIUM)\s*"/gi;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(openTag))) found.add(m[1]!.toUpperCase());
  // Valeurs contradictoires => non vérifiable.
  return found.size === 1 ? SUPPLIER_TIER[[...found][0]!]! : null;
}

export const DISTRICASH_ORIGIN = "https://districashv2.inoshop.net";
const DISTRICASH_HOST = "districashv2.inoshop.net";

/** Valide une URL de fiche Districash : HTTPS, hôte exact, /catalog/product/, sans query/fragment. */
export function safeDistricashProductUrl(href: string | null | undefined): string | null {
  if (!href) return null;
  const raw = decode(href).trim();
  if (!raw || /^\s*(javascript|data|vbscript):/i.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw, DISTRICASH_ORIGIN + "/");
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.host !== DISTRICASH_HOST) return null;
  if (u.username || u.password || u.search || u.hash) return null;
  if (!/^\/catalog\/product\/[^/]+(\/[^/]+)*\/?$/.test(u.pathname)) return null;
  return u.toString();
}

function productUrlOf(rowHtml: string): string | null {
  const re = /<a\b[^>]*\bhref\s*=\s*"([^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowHtml))) {
    if (!decode(m[1] ?? "").includes("/catalog/product/")) continue;
    const ok = safeDistricashProductUrl(m[1]);
    if (ok) return ok;
  }
  return null;
}

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

/**
 * Codes `data-dispo-type` relevés dans la légende du portail (15/10/2026) :
 * ag = vert « En agence » (J) ; grp = pastille verte « Disponible Plateforme » (J+) ;
 * agpart = orange partiel, agvirt = interrogation manufacturier, partner = non
 * vérifié => inconnu (jamais proposé) ; nonecmd = rouge, noref = gris => indisponible.
 */
function availabilityOf(rowHtml: string, dispoType: string | null): DistricashAvailability {
  const t = (dispoType ?? "").trim().toUpperCase();
  if (t === "NONECMD" || t === "NOREF") return "indisponible";
  if (t === "AG" || t === "J") return "J";
  if (t === "GRP" || t === "J+") return "J+";
  if (t) return "inconnu";
  // Sans code : seule l'icône de dispo de la ligne fait foi.
  if (/rouge\.png|gris\.png/i.test(rowHtml)) return "indisponible";
  if (rowHtml.includes(DISTRICASH_JPLUS_IMAGE)) return "J+";
  if (/\/stock\/vert\.png/i.test(rowHtml)) return "J";
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
      productUrl: productUrlOf(inner),
      family: attr(open, "data-filtresous-familles-lib"),
      supplierTier: districashSupplierTier(open),
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

/** Gammes connues (libellé compacté sans espaces/tirets). Modèle inconnu => null. */
const ALL_SEASON_MODELS = [
  "ALLSEASONCONTACT", "CROSSCLIMATE", "QUATRAC", "4SEASON", "ALLSEASON", "MULTISEASON",
  "VECTOR4SEASON", "KINERGY4S", "ADVANTAGEAS", "ADVANTAGEALLSEASON", "ACTIVEDRIVE4S",
  "QUADRAXER", "CINTURATOALLSEASON", "TURANZAALLSEASON", "WEATHERCONTROL",
];
const WINTER_MODELS = ["WINTER", "HIVER", "ALPIN", "WINTRAC", "SNOW", "NORDIC", "TS8", "TS850", "TS860", "TS870", "KRISALP", "ICECONTACT", "BLIZZAK", "ULTRAGRIPICE", "ULTRAGRIP"];
const SUMMER_MODELS = [
  "SUMMER", "PREMIUMCONTACT", "ECOCONTACT", "SPORTCONTACT", "PRIMACY", "PILOTSPORT", "ENERGYSAVER",
  "DYNAXERHP", "DYNAXERUHP", "ATREZZOELITE", "ELITESH32", "SH32", "VENTUS", "TURANZAT", "POTENZA",
  "EAGLEF1", "EFFICIENTGRIP", "CINTURATOP", "PZERO", "KINERGYECO", "SPORTMAXX", "BLURESPONSE",
  "FIREHAWK", "ROADHAWK", "ZIEX", "ECSTA", "SOLUS", "RAINSPORT", "RAINEXPERT", "NBLUEHD",
];

/** Saison uniquement si le libellé l'indique clairement ; sinon null (jamais devinée). */
/** Saison déclarée par la sous-famille portail (« TOURISME ETE / HIVER / TOUTES SAIS »), sinon null. */
export function districashFamilySeason(family: string | null | undefined): "ete" | "quatre_saisons" | "hiver" | null {
  const f = (family ?? "").toUpperCase();
  if (/TOUTES\s*SAIS|4\s*SAISONS|ALL\s*SEASON/.test(f)) return "quatre_saisons";
  if (/HIVER|WINTER/.test(f)) return "hiver";
  if (/\bETE\b|SUMMER/.test(f)) return "ete";
  return null;
}

/** Saison d'une ligne : sous-famille portail en priorité, puis libellé explicite ; jamais devinée. */
export function districashRowSeason(r: Pick<DistricashRow, "label" | "family">) {
  return districashFamilySeason(r.family) ?? districashSeason(r.label);
}

export function districashSeason(label: string): "ete" | "quatre_saisons" | "hiver" | null {
  const l = ` ${label.toUpperCase()} `;
  const c = label.toUpperCase().replace(/[^A-Z0-9+]/g, "");
  // Ordre : 4 saisons d'abord (« PRIMACY ALL SEASON », « ADVANTAGE AS »), puis hiver, puis été.
  if (/\b4S\d?\b/.test(l) || ALL_SEASON_MODELS.some((m) => c.includes(m))) return "quatre_saisons";
  if (/\b(ICE|W\d{3})\b/.test(l) || WINTER_MODELS.some((m) => c.includes(m))) return "hiver";
  if (/\bETE\b/.test(l) || /\bPC\s?[67]\b/.test(l) || SUMMER_MODELS.some((m) => c.includes(m))) return "ete";
  return null;
}

/** Comptage des lignes écartées (diagnostic interne : jamais confondu avec un stock). */
export function districashExclusions(rows: DistricashRow[]) {
  return {
    total: rows.length,
    unavailable: rows.filter((r) => r.availability === "indisponible").length,
    unknown: rows.filter((r) => r.availability === "inconnu").length,
    noPrice: rows.filter((r) => (r.availability === "J" || r.availability === "J+") && r.purchaseHt == null).length,
  };
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
      // Marque paramétrée : sa gamme prime ; sinon gamme déclarée par le portail.
      tier: tierOf(brand) ?? r.supplierTier ?? "",
      season: districashRowSeason(r) ?? "",
      is3pmsf: /3PMSF|\bM\+S\b.*\bSNOW/i.test(r.label),
      brand,
      model: r.label,
      size: d.size,
      purchase_price_ht: r.purchaseHt,
      price_kind: "purchase_ht",
      mount_price_ttc: 0,
      source: "Districash (prix d'achat portail)",
      source_url: null,
      product_url: r.productUrl ?? null,
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
