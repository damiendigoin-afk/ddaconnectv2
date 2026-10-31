/**
 * Top prix — orchestration commune (navigateur interne ET façade web serveur).
 *
 * Les sources sont injectées : l'écran interne passe par les fonctions serveur
 * authentifiées, la façade web par les lectures serveur directes. Le calcul
 * (buildSevenOffers + pickTopPriceOffers + priceOffer) est strictement le même.
 * Aucune offre, aucun prix, aucune gamme n'est simulé.
 */
import { districashExclusions, districashRowsToOffers, type DistricashRow } from "./districash";
import {
  buildSevenOffers,
  configuredTierMap,
  pickTopPriceOffers,
  publicItemsToOffers,
  publicItemsToTopPriceOffers,
  quoteBrandsOf,
  tierOfBrand,
  type BrandTierRow,
  type PublicTireItem,
  type SevenOffer,
  type TireOffer,
  type TireSeason,
} from "./tires";
import type { CommercialSettings, ServicePackage } from "./pricing-engine";
import { unclassifiedBrands, type SourceTier } from "./tire-top-price-source";

export type TopPriceEngine = {
  settings: CommercialSettings | null;
  catalog: TireOffer[];
  packages: ServicePackage[];
  brands: BrandTierRow[];
};

type CentraleAll = { ok: boolean; items: PublicTireItem[]; error: string; truncated: boolean; pagesRead: number };
type CentraleLegacy = { ok: boolean; items: PublicTireItem[]; error: string };
type DistricashRes = { ok: boolean; rows: DistricashRow[]; error: string; consultedAt: string };

export type TopPriceSources = {
  centraleAllBrands: (a: { season: TireSeason; configured: Record<string, SourceTier | null> }) => Promise<CentraleAll>;
  centraleLegacy: (brands: string[]) => Promise<CentraleLegacy>;
  /** null : aucun compte Districash résolu (site absent). */
  districash: (() => Promise<DistricashRes>) | null;
};

export type TopPriceSourceStatus = { source: "centralepneus" | "districash"; ok: boolean };

export type TopPriceResult = {
  size: string;
  quantity: number;
  requestedBrand: string | null;
  requested: SevenOffer | null;
  grid: SevenOffer[];
  /** Avertissements internes (noms de fournisseurs) — jamais exposés au public. */
  warning: string;
  sources: TopPriceSourceStatus[];
  /** Offres réellement consultées (écran interne : rotation de marque). Jamais exposé au public. */
  pool: TireOffer[];
  /** Exigences de conformité utilisées pour la grille. */
  required: { size: string | null; load: string | null; speed: string | null };
};

/** Conversion des lignes Districash (même logique que le mode fournisseur). */
export function districashOffersOf(
  res: DistricashRes,
  brands: BrandTierRow[],
): { offers: TireOffer[]; warning: string } {
  if (!res.ok) return { offers: [], warning: res.error };
  const tierOf = (b: string) => brands.find((r) => r.active && r.brand.trim().toUpperCase() === b)?.tier ?? null;
  const offers = districashRowsToOffers(res.rows, tierOf, res.consultedAt) as unknown as TireOffer[];
  const x = districashExclusions(res.rows);
  const noSeason = offers.filter((o) => !o.season).length;
  const excluded = [
    x.unavailable ? `${x.unavailable} indisponible(s)` : "",
    x.unknown ? `${x.unknown} à disponibilité non reconnue` : "",
    x.noPrice ? `${x.noPrice} sans prix` : "",
    noSeason ? `${noSeason} de saison non identifiée` : "",
  ].filter(Boolean);
  let warning = "";
  if (!offers.length) warning = "Districash : aucun pneu disponible (J/J+) avec prix pour cette dimension.";
  if (excluded.length)
    warning = [warning, `Districash : ${x.total} pneu(s) lus, écartés des gammes : ${excluded.join(", ")}.`].filter(Boolean).join(" ");
  return { offers, warning };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : "consultation impossible");

export async function runTopPrice(
  args: {
    size: string;
    load: string | null;
    speed: string | null;
    requestedBrand: string | null;
    quantity: number;
    engine: TopPriceEngine;
  },
  sources: TopPriceSources,
): Promise<TopPriceResult> {
  const { engine } = args;
  const configured = configuredTierMap(engine.brands);
  const SHORT: Record<TireSeason, string> = { ete: "été", quatre_saisons: "4 saisons", hiver: "hiver" };

  const all = (season: TireSeason) =>
    sources
      .centraleAllBrands({ season, configured })
      .then((r) => ({
        ok: r.ok,
        offers: r.ok ? publicItemsToTopPriceOffers(r.items, engine.brands) : [],
        warning: !r.ok
          ? `CentralePneus : ${r.error}`
          : r.truncated
            ? `CentralePneus (${SHORT[season]}) : consultation limitée aux ${r.pagesRead * 50} pneus les moins chers.`
            : "",
      }))
      .catch((e) => ({ ok: false, offers: [] as TireOffer[], warning: `CentralePneus : ${errText(e)}` }));

  const legacy = sources
    .centraleLegacy(quoteBrandsOf(engine.brands, [args.requestedBrand]))
    .then((r) => ({
      ok: r.ok,
      offers: r.ok ? publicItemsToOffers(r.items, engine.brands) : [],
      warning: r.ok ? "" : `CentralePneus : ${r.error}`,
    }))
    .catch((e) => ({ ok: false, offers: [] as TireOffer[], warning: `CentralePneus : ${errText(e)}` }));

  const dcFn = sources.districash;
  const dc = dcFn
    ? dcFn()
        .then((r) => ({ ok: r.ok, ...districashOffersOf(r, engine.brands) }))
        .catch((e) => ({ ok: false, offers: [] as TireOffer[], warning: `Districash : ${errText(e)}` }))
    : Promise.resolve({ ok: false, offers: [] as TireOffer[], warning: "Districash : aucun site sélectionné." });

  const [ete, qs, leg, dist] = await Promise.all([all("ete"), all("quatre_saisons"), legacy, dc]);

  const seen = new Set<string>();
  const offers: TireOffer[] = [];
  for (const o of [...ete.offers, ...qs.offers, ...leg.offers, ...engine.catalog, ...dist.offers]) {
    const k = String(o.id);
    if (seen.has(k)) continue;
    seen.add(k);
    offers.push(o);
  }
  const required = { size: args.size, load: args.load, speed: args.speed };

  // Structure d'origine (marque demandée + 6 cases) produite par le moteur habituel.
  const [identical, ...base] = buildSevenOffers({
    offers,
    brands: engine.brands,
    packages: engine.packages,
    settings: engine.settings,
    quantity: args.quantity,
    mounted: { brand: args.requestedBrand, model: null, size: args.size, season: null },
    required,
  });
  const top = new Map<string, SevenOffer>();
  for (const season of ["ete", "quatre_saisons"] as TireSeason[]) {
    for (const o of pickTopPriceOffers({ offers, brands: engine.brands, settings: engine.settings, quantity: args.quantity, season, required })) {
      top.set(o.slot, o);
    }
  }
  const grid = base.map((slot) => {
    const best = top.get(slot.slot);
    if (!best) return slot;
    return { ...best, slot: slot.slot, kind: slot.kind, title: slot.title, tier: slot.tier, season: slot.season };
  });

  const warnings = [ete.warning, qs.warning, leg.warning, dist.warning].filter(Boolean);
  const unclassified = unclassifiedBrands(
    offers.map((o) => ({ brand: o.brand, tier: o.tier })),
    Object.fromEntries(engine.brands.map((r) => [r.brand.trim().toLowerCase(), tierOfBrand(engine.brands, r.brand)])),
  );
  if (unclassified.length) warnings.push(`Top prix — marques non classées (exclues) : ${unclassified.join(", ")}.`);
  const requested =
    args.requestedBrand && identical ? { ...identical, title: `Marque demandée : ${args.requestedBrand}` } : null;
  return {
    size: args.size,
    quantity: args.quantity,
    requestedBrand: args.requestedBrand,
    requested,
    grid,
    warning: [...new Set(warnings)].join(" "),
    pool: offers,
    required,
    sources: [
      { source: "centralepneus", ok: ete.ok || qs.ok || leg.ok },
      { source: "districash", ok: dist.ok },
    ],
  };
}
