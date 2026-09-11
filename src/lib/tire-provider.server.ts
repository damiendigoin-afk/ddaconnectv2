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
  consultedAt: string;
};

export type PublicTireResult =
  | { ok: true; items: PublicTireItem[]; sourceUrl: string; consultedAt: string }
  | { ok: false; error: string; sourceUrl: string; consultedAt: string };

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
  price?: number;
};

/** Lecture des blocs `view_item_list` publiés dans la page (données publiques). */
export function extractItems(html: string, sourceUrl: string, consultedAt: string): PublicTireItem[] {
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
      const price = Number(raw.price);
      const name = (raw.item_name ?? "").trim();
      const ref = (raw.item_id ?? "").trim();
      if (!ref || !name || !Number.isFinite(price) || price <= 0) continue;

      const dim = /(\d{3}\/\d{2})\s*R\s*(\d{2})(C?)/i.exec(name);
      const idx = /R\s*\d{2}C?\s+(\d{2,3}(?:\/\d{2,3})?)\s*([A-Z])\b/i.exec(name);
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

        publicPriceTtc: Math.round(price * 100) / 100,
        availability: null,
        sourceUrl,
        consultedAt,
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

