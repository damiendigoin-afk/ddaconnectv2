import { globalBrandTier, normalizeBrandKey } from "./tire-brand-reference";
/**
 * Top prix — règles pures de consultation « toutes marques ».
 *
 * CentralePneus publie pour chaque produit une gamme (`item_category5` :
 * discount / quality / premium). C'est l'unique gamme source reconnue pour une
 * marque absente du paramétrage DDA ; elle n'est jamais déduite du prix.
 */
export type SourceTier = "entree" | "milieu" | "haut";

const CATEGORY_TIER: Record<string, SourceTier> = {
  discount: "entree",
  budget: "entree",
  quality: "milieu",
  premium: "haut",
};

/** Gamme déclarée par CentralePneus, sinon null (aucune supposition). */
export function sourceTierOfCategory(raw: unknown): SourceTier | null {
  if (typeof raw !== "string") return null;
  return CATEGORY_TIER[raw.trim().toLowerCase()] ?? null;
}

/** Code saison du filtre CentralePneus. */
export function centraleSeasonCode(season: "ete" | "quatre_saisons" | "hiver"): string {
  return season === "ete" ? "S" : season === "hiver" ? "W" : "G";
}

/** Page n (1-based) de la dimension, filtrée sur la saison, triée par prix croissant. */
export function topPricePageUrl(sizeUrl: string, seasonCode: string, page: number): string {
  const q = `seasons%5B%5D=${seasonCode}&sort=price${page > 1 ? `&p=${page}` : ""}`;
  return `${sizeUrl}?${q}`;
}

const SPEEDS = "LMNPQRSTUHVWY";
function speedRank(s: string | null | undefined): number {
  const c = (s ?? "").trim().toUpperCase();
  if (c === "ZR") return SPEEDS.length + 1;
  const i = SPEEDS.indexOf(c);
  return c.length === 1 && i >= 0 ? i : -1;
}
function firstLoad(l: string | null | undefined): number {
  const n = parseInt((l ?? "").split("/")[0] ?? "", 10);
  return Number.isFinite(n) ? n : -1;
}

/**
 * Pré-contrôle serveur des indices, en MINIMA (charge/vitesse supérieures
 * acceptées). Plus strict que offerMeetsRequirement (indice inconnu ou
 * dérogation 3PMSF non comptés) : il ne sert qu'à arrêter la pagination, donc
 * il ne peut que faire lire davantage de pages, jamais écarter une offre.
 */
export function meetsIndicesStrict(
  item: { loadIndex: string | null; speedIndex: string | null },
  load: string | null,
  speed: string | null,
): boolean {
  if (load && firstLoad(item.loadIndex) < firstLoad(load)) return false;
  if (speed && speedRank(item.speedIndex) < speedRank(speed)) return false;
  return true;
}

/** Gamme effective : paramétrage DDA prioritaire, sinon gamme source fiable. */
export function effectiveTier(
  brand: string,
  sourceTier: SourceTier | null | undefined,
  configured: Record<string, SourceTier | null>,
): SourceTier | null {
  const k = normalizeBrandKey(brand);
  if (k in configured && configured[k] == null) return null; // marque désactivée par le garage
  return globalBrandTier(brand) ?? configured[k] ?? sourceTier ?? null;
}

/**
 * Pagination terminée quand chaque gamme dispose d'au moins `perTier` offres
 * conformes : les pages étant triées par prix croissant, la première offre
 * conforme de chaque gamme est la moins chère toutes marques confondues.
 */
export function topPriceCoverageComplete(
  items: { brand: string; sourceTier?: SourceTier | null; loadIndex: string | null; speedIndex: string | null }[],
  configured: Record<string, SourceTier | null>,
  load: string | null,
  speed: string | null,
  perTier = 2,
): boolean {
  const count: Record<SourceTier, number> = { entree: 0, milieu: 0, haut: 0 };
  for (const it of items) {
    const t = effectiveTier(it.brand, it.sourceTier, configured);
    if (t && meetsIndicesStrict(it, load, speed)) count[t]++;
  }
  return count.entree >= perTier && count.milieu >= perTier && count.haut >= perTier;
}

/** Marques sans gamme fiable (ni paramétrage DDA, ni gamme source) : diagnostic. */
export function unclassifiedBrands(
  offers: { brand: string; tier: string | null }[],
  configured: Record<string, SourceTier | null> = {},
): string[] {
  const out = new Set<string>();
  for (const o of offers) {
    const raw = o.tier === "entree" || o.tier === "milieu" || o.tier === "haut" ? o.tier : null;
    if (!effectiveTier(o.brand, raw, configured) && o.brand.trim()) out.add(o.brand.trim().toUpperCase());
  }
  return [...out].sort();
}

/** Valeur de l'option « Top prix » du sélecteur Fournisseur (hors QuoteTireSupplierKey). */
export const TOP_PRICE_OPTION = "top_prix";
