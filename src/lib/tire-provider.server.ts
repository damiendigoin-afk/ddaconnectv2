/**
 * Source tarifaire pneumatique publique — CentralePneus.
 *
 * Aucune API, aucun identifiant : on consulte la page publique de la dimension
 * recherchée et on lit les prix publics TTC réellement affichés. Si la page
 * n'est pas exploitable, on ne simule jamais un prix : la consultation est
 * signalée comme indisponible.
 */

export type PublicTireItem = {
  supplierRef: string;
  brand: string;
  model: string;
  size: string | null;
  loadIndex: string | null;
  speedIndex: string | null;
  season: "ete" | "quatre_saisons" | "hiver" | null;
  /** Marquage hiver 3PMSF lu dans le libellé fournisseur. */
  is3pmsf: boolean;
  /** Prix public TTC réellement affiché (coût d'achat TTC du garage). */

  publicPriceTtc: number;
  availability: string | null;
  sourceUrl: string;
  /** Fiche produit exacte lue dans la carte du produit (usage interne), sinon null. */
  productUrl?: string | null;
  consultedAt: string;
  /** Gamme déclarée par CentralePneus (item_category5), utilisée seulement par Top prix. */
  sourceTier?: SourceTier | null;
};

export type PublicTireResult =
  | { ok: true; items: PublicTireItem[]; sourceUrl: string; consultedAt: string }
  | { ok: false; error: string; sourceUrl: string; consultedAt: string };

import {
  centraleSeasonCode,
  sourceTierOfCategory,
  topPriceCoverageComplete,
  topPricePageUrl,
  type SourceTier,
} from "./tire-top-price-source";

const BASE = "https://www.centralepneus.fr";
const TIMEOUT_MS = 12_000;
/** Saisons nécessaires au chiffrage des six gammes. */
const REQUIRED_SEASONS = ["ete", "quatre_saisons"] as const;


/** 205/55R16 → { width: 205, ratio: 55, diameter: 16 } */
export function parseSize(size: string | null | undefined) {
  const m = /(\d{3})\s*\/\s*(\d{2})\s*[RZ]?\s*(\d{2})/i.exec((size ?? "").toUpperCase());
  if (!m) return null;
  return { width: m[1]!, ratio: m[2]!, diameter: m[3]! };
}

export function providerUrlFor(size: string): string | null {
  const p = parseSize(size);
  if (!p) return null;
  return `${BASE}/pneu-auto-${p.width}-${p.ratio}-${p.diameter}/`;
}

function seasonOf(code: unknown): PublicTireItem["season"] {
  if (code === "S") return "ete";
  if (code === "W") return "hiver";
  if (code === "G") return "quatre_saisons";
  return null;
}

type RawItem = {
  item_id?: string;
  item_name?: string;
  item_brand?: string;
  item_category4?: string;
  item_category5?: string;
  price?: number;
};

/** Prix "60,59" / "1 060,59" → 60.59 ; null si illisible. */
function frNumber(raw: string): number | null {
  const v = Number(raw.replace(/[\s\u00a0\u202f]/g, "").replace(",", "."));
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
}

function plainText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&#8202;|&nbsp;/g, " ").replace(/\s+/g, " ");
}

/**
 * Cartes produit affichées : identifiant produit → prix unitaire TTC affiché et
 * libellé visible. Le prix est lu DANS la carte du produit (bloc `price` →
 * `price__amount--value`), jamais par position dans une autre liste. Un prix
 * barré éventuel (`old`, `strike`, `crossed`) est ignoré.
 */
/**
 * Lien de la fiche produit tel qu'il figure dans la carte : chemin
 * `/pneu-auto/...-<identifiant>` du même produit, paramètres retirés. Aucun lien
 * n'est construit : sans lien conforme dans la carte, null.
 */
export function productUrlFromCard(card: string, id: string): string | null {
  const re = /href="(\/pneu-auto\/[^"?#]+)(?:[?#][^"]*)?"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(card)) !== null) {
    const path = m[1]!;
    if (path.endsWith(`-${id}`)) return `${BASE}${path}`;
  }
  return null;
}

export function extractDisplayedCards(
  html: string,
): Map<string, { priceTtc: number; text: string; productUrl: string | null }> {
  const out = new Map<string, { priceTtc: number; text: string; productUrl: string | null }>();
  const parts = html.split(/<div class="product-list-item"(?=[\s>])/);
  for (const card of parts.slice(1)) {
    const id = /data-gtm--select-item-identifier-param="([\w-]+)"/.exec(card)?.[1];
    if (!id || out.has(id)) continue;
    const block = /class="price\s*"[\s\S]*?class="price__amount--value"\s*>\s*([\d\s\u00a0\u202f.,]+?)\s*</.exec(card);
    const price = block ? frNumber(block[1]!) : null;
    if (price == null) continue;
    out.set(id, { priceTtc: price, text: plainText(card), productUrl: productUrlFromCard(card, id) });
  }
  return out;
}

/** Tolérance entre prix affiché TTC et prix HT du dataLayer × 1,2 (arrondis). */
const PRICE_COHERENCE = 0.03;

/**
 * Lecture des offres publiques. Métadonnées (marque, libellé, saison) issues des
 * blocs `view_item_list` ; PRIX = prix TTC affiché dans la carte du même
 * identifiant produit. Le `price` du dataLayer est HT : il ne sert qu'au
 * contrôle de cohérence. Sans carte, prix illisible, libellé discordant ou
 * prix incohérent, l'article est écarté (jamais de prix voisin).
 */
export function extractItems(html: string, sourceUrl: string, consultedAt: string): PublicTireItem[] {
  const cards = extractDisplayedCards(html);
  const byRef = new Map<string, PublicTireItem>();
  const re = /dataLayer\.push\((\{"event":"view_item_list"[\s\S]*?\})\);/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]!);
    } catch {
      continue;
    }
    const list = (parsed as { ecommerce?: { items?: RawItem[] } }).ecommerce?.items ?? [];
    for (const raw of list) {
      const name = (raw.item_name ?? "").trim();
      const ref = (raw.item_id ?? "").trim();
      if (!ref || !name || byRef.has(ref)) continue;
      const card = cards.get(ref.replace(/^tyre/i, ""));
      if (!card) continue;

      const dim = /(\d{3}\/\d{2})\s*R\s*(\d{2})(C?)/i.exec(name);
      const idx = /R\s*\d{2}C?\s+(\d{2,3}(?:\/\d{2,3})?)\s*([A-Z])\b/i.exec(name);
      // La carte doit afficher la même dimension et les mêmes indices.
      const norm = (v: string) => v.replace(/\s+/g, "").toUpperCase();
      const cardText = norm(card.text);
      if (dim && !cardText.includes(norm(`${dim[1]}R${dim[2]}${dim[3]}`))) continue;
      if (idx && !cardText.includes(norm(`R${dim?.[2] ?? ""}${dim?.[3] ?? ""}${idx[1]}${idx[2]}`))) continue;

      const dlHt = Number(raw.price);
      if (Number.isFinite(dlHt) && dlHt > 0) {
        const expected = dlHt * 1.2;
        if (Math.abs(card.priceTtc - expected) / card.priceTtc > PRICE_COHERENCE) continue;
      }

      const brand = (raw.item_brand ?? "").trim() || name.split(" ")[0]!;
      const model = name
        .replace(brand, "")
        .replace(/\s*\d{3}\/\d{2}\s*R[\s\S]*$/i, "")
        .trim();

      byRef.set(ref, {
        supplierRef: ref,
        brand,
        model: model || name,
        size: dim ? `${dim[1]}R${dim[2]}${dim[3] ? "C" : ""}` : null,
        loadIndex: idx ? idx[1]! : null,
        speedIndex: idx ? idx[2]!.toUpperCase() : null,
        season: seasonOf(raw.item_category4),
        is3pmsf: /3\s*pmsf/i.test(name),
        publicPriceTtc: card.priceTtc,
        availability: null,
        sourceUrl,
        productUrl: card.productUrl,
        consultedAt,
        sourceTier: sourceTierOfCategory(raw.item_category5),
      });
    }
  }
  return [...byRef.values()];
}

/**
 * Filtres de marque publiés dans la page de dimension : marque → identifiant
 * fournisseur. Ils servent à consulter directement les résultats d'une marque
 * qui n'apparaît pas sur la première page de la dimension.
 */
export function extractBrandFilters(html: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /id="brands_(\d+)"[^>]*value="(\d+)"[^>]*>[\s\S]{0,120}?for="brands_\1"[^>]*>([^<]+)</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const label = m[3]!.trim();
    if (label) out.set(label.toLowerCase(), m[2]!);
  }
  return out;
}

/** URL des résultats d'une dimension filtrés sur une marque du fournisseur. */
export function brandFilterUrl(sizeUrl: string, brandId: string): string {
  return `${sizeUrl}?brands%5B%5D=${brandId}`;
}

/**
 * Marques à consulter via leur filtre fournisseur. Une marque peut n'apparaître
 * sur la première page que dans une seule saison : la consultation filtrée est
 * déclenchée dès qu'une saison nécessaire (été / 4 saisons) manque, et pas
 * seulement quand la marque est totalement absente.
 */
export function brandsToRefetch(
  items: PublicTireItem[],
  wanted: string[],
  filters: Map<string, string>,
): { brand: string; id: string }[] {
  const complete = (brand: string) =>
    REQUIRED_SEASONS.every((s) =>
      items.some((i) => i.brand.trim().toLowerCase() === brand && i.season === s),
    );
  return wanted
    .filter((b) => !complete(b))
    .map((b) => ({ brand: b, id: filters.get(b) }))
    .filter((x): x is { brand: string; id: string } => Boolean(x.id))
    .slice(0, 12);
}


async function getHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept-Language": "fr-FR,fr;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Consultation publique réelle, refaite à chaque chiffrage/recalcul.
 * `brands` : marques réellement nécessaires au chiffrage (gammes paramétrées +
 * marque demandée). La page générique ne montrant que les premiers produits,
 * ces marques sont consultées via leur filtre fournisseur, puis fusionnées.
 */
export async function fetchPublicTires(size: string, brands: string[] = []): Promise<PublicTireResult> {
  const consultedAt = new Date().toISOString();
  const url = providerUrlFor(size);
  if (!url) {
    return { ok: false, error: "Dimension non exploitable pour la consultation tarifaire.", sourceUrl: BASE, consultedAt };
  }
  const html = await getHtml(url);
  if (html == null) {
    return { ok: false, error: "Tarif actuellement indisponible.", sourceUrl: url, consultedAt };
  }
  const items = extractItems(html, url, consultedAt);
  if (!items.length) {
    return { ok: false, error: "Tarif actuellement indisponible pour cette dimension.", sourceUrl: url, consultedAt };
  }

  const wanted = [...new Set(brands.map((b) => b.trim().toLowerCase()).filter(Boolean))];
  if (wanted.length) {
    const filters = extractBrandFilters(html);
    const missing = brandsToRefetch(items, wanted, filters);


    const pages = await Promise.all(
      missing.map(async (x) => {
        const brandUrl = brandFilterUrl(url, x.id);
        const page = await getHtml(brandUrl);
        return page ? extractItems(page, brandUrl, consultedAt) : [];
      }),
    );
    const seen = new Set(items.map((i) => i.supplierRef));
    for (const list of pages) {
      for (const it of list) {
        if (seen.has(it.supplierRef)) continue;
        seen.add(it.supplierRef);
        items.push(it);
      }
    }
  }

  return { ok: true, items, sourceUrl: url, consultedAt };
}


/** Nombre maximal de pages (50 pneus/page) lues pour un Top prix. */
const TOP_PRICE_MAX_PAGES = 12;

/**
 * Top prix — consultation TOUTES MARQUES : la dimension filtrée sur la saison,
 * triée par prix croissant, page après page, sans aucune liste de marques.
 * Arrêt dès que chaque gamme (paramétrage DDA, sinon gamme source) a des
 * offres conformes aux indices, ou à la dernière page / plafond de pages.
 */
export async function fetchPublicTiresAllBrands(args: {
  size: string;
  season: "ete" | "quatre_saisons" | "hiver";
  load: string | null;
  speed: string | null;
  configured: Record<string, SourceTier | null>;
}): Promise<PublicTireResult & { pagesRead?: number; truncated?: boolean }> {
  const consultedAt = new Date().toISOString();
  const url = providerUrlFor(args.size);
  if (!url) return { ok: false, error: "Dimension non exploitable pour la consultation tarifaire.", sourceUrl: BASE, consultedAt };
  const code = centraleSeasonCode(args.season);
  const items: PublicTireItem[] = [];
  const seen = new Set<string>();
  let pagesRead = 0;
  let truncated = false;
  for (let p = 1; p <= TOP_PRICE_MAX_PAGES; p++) {
    const pageUrl = topPricePageUrl(url, code, p);
    const html = await getHtml(pageUrl);
    if (html == null) {
      if (p === 1) return { ok: false, error: "Tarif actuellement indisponible.", sourceUrl: pageUrl, consultedAt };
      break;
    }
    pagesRead = p;
    const list = extractItems(html, pageUrl, consultedAt);
    let added = 0;
    for (const it of list) {
      if (seen.has(it.supplierRef)) continue;
      seen.add(it.supplierRef);
      items.push(it);
      added++;
    }
    if (!added) break; // fin des résultats
    if (topPriceCoverageComplete(items, args.configured, args.load, args.speed)) break;
    if (p === TOP_PRICE_MAX_PAGES) truncated = true;
  }
  if (!items.length) return { ok: false, error: "Tarif actuellement indisponible pour cette dimension.", sourceUrl: url, consultedAt };
  return { ok: true, items, sourceUrl: url, consultedAt, pagesRead, truncated };
}
