/**
 * Devis pneus manuels — nouvelle porte d'entrée vers le MOTEUR EXISTANT.
 *
 * Aucun calcul n'est refait ici : on réutilise strictement `buildSevenOffers`
 * (marques préférées, marges, montage) et la consultation CentralePneus déjà
 * employées par le chiffrage automatique des Tours Véhicule. Ce module ne fait
 * que collecter la dimension saisie, appeler le moteur et archiver le résultat.
 */
import { supabase } from "@/integrations/supabase/client";
import type { CommercialSettings, ServicePackage } from "./pricing-engine";
import { fetchPublicTireOffers } from "./tire-provider.functions";
import {
  buildSevenOffers,
  defaultBrandOf,
  fetchBrandTiers,
  normalizeTireSize,
  publicItemsToOffers,
  type BrandTierRow,
  type PublicTireItem,
  type SevenOffer,
  type TireOffer,
} from "./tires";


export type TireQuoteRow = {
  id: string;
  created_at: string;
  site_id: string | null;
  site_label: string | null;
  user_id: string | null;
  user_name: string | null;
  size: string;
  width: string | null;
  height: string | null;
  diameter: string | null;
  load_index: string | null;
  speed_index: string | null;
  requested_brand: string | null;
  customer_name: string | null;
  plate: string | null;
  vehicle_label: string | null;
  quantity: number;
  margin_adjustment_pct: number | null;
  offers: SevenOffer[];
};

export type TireQuoteForm = {
  width: string;
  height: string;
  diameter: string;
  load: string;
  speed: string;
  brand: string;
  customerName: string;
  plate: string;
  vehicleLabel: string;
  quantity: number;
};

export const EMPTY_TIRE_QUOTE_FORM: TireQuoteForm = {
  width: "",
  height: "",
  diameter: "",
  load: "",
  speed: "",
  brand: "",
  customerName: "",
  plate: "",
  vehicleLabel: "",
  quantity: 2,
};

/** Dimension normalisée à partir des trois champs (ex. 205/55R16). */
export function sizeFromForm(f: Pick<TireQuoteForm, "width" | "height" | "diameter">): string | null {
  const w = f.width.trim();
  const h = f.height.trim();
  const d = f.diameter.trim();
  if (!/^\d{3}$/.test(w) || !/^\d{2}$/.test(h) || !/^\d{2}$/.test(d)) return null;
  return normalizeTireSize(`${w}/${h}R${d}`);
}

/** Découpe une dimension lue par OCR (ex. « 205/55 R16 91V ») en champs de saisie. */
export function formFromReference(ref: {
  size?: string | null;
  load_index?: string | null;
  speed_index?: string | null;
  brand?: string | null;
}): Partial<TireQuoteForm> {
  const m = /(\d{3})\s*\/\s*(\d{2})\s*[RZ]{0,2}\s*(\d{2})/i.exec(ref.size ?? "");
  const out: Partial<TireQuoteForm> = {};
  if (m) {
    out.width = m[1]!;
    out.height = m[2]!;
    out.diameter = m[3]!;
  }
  if (ref.load_index) out.load = String(ref.load_index).replace(/[^\d]/g, "");
  if (ref.speed_index) out.speed = String(ref.speed_index).toUpperCase().slice(0, 1);
  if (ref.brand) out.brand = String(ref.brand);
  return out;
}

export type TireEngineData = {
  settings: CommercialSettings | null;
  catalog: TireOffer[];
  packages: ServicePackage[];
  brands: BrandTierRow[];
};

/** Mêmes sources que le chiffrage automatique du Tour Véhicule. */
export async function fetchTireEngine(): Promise<TireEngineData> {
  const [settingsRes, catalogRes, packagesRes, brands] = await Promise.all([
    supabase.from("commercial_settings").select("*").limit(1).maybeSingle(),
    supabase.from("tire_offers").select("*").eq("active", true),
    supabase.from("service_packages").select("*").eq("active", true),
    fetchBrandTiers(),
  ]);
  return {
    settings: (settingsRes.data ?? null) as CommercialSettings | null,
    catalog: (catalogRes.data ?? []) as TireOffer[],
    packages: (packagesRes.data ?? []) as ServicePackage[],
    brands,
  };
}

export type ManualQuoteResult = {
  size: string;
  quantity: number;
  requestedBrand: string | null;
  /** Offre correspondant à la marque demandée (null si aucune marque demandée). */
  requested: SevenOffer | null;
  /** Les 6 offres automatiques entrée / milieu / haut × été / 4 saisons. */
  grid: SevenOffer[];
  /** Message de consultation tarifaire (jamais de prix simulé). */
  warning: string;
};

/**
 * Chiffrage d'une dimension saisie manuellement.
 * `buildSevenOffers` renvoie l'offre « à l'identique » (ici : la marque
 * demandée) puis les 6 gammes ; les 6 gammes restent toujours affichées.
 */
export async function quoteManualTires(args: {
  size: string;
  load: string | null;
  speed: string | null;
  requestedBrand: string | null;
  quantity: number;
  engine: TireEngineData;
}): Promise<ManualQuoteResult> {
  const { engine } = args;
  let warning = "";
  let items: PublicTireItem[] = [];
  // Marques réellement nécessaires : gammes paramétrées + marque demandée.
  const neededBrands = [
    ...(["entree", "milieu", "haut"] as const).map((t) => defaultBrandOf(engine.brands, t)),
    args.requestedBrand,
  ].filter((b): b is string => Boolean(b && b.trim()));
  const res = await fetchPublicTireOffers({ data: { size: args.size, brands: neededBrands } });
  if (res.ok) items = res.items as PublicTireItem[];
  else warning = res.error;


  const offers = buildSevenOffers({
    offers: [...publicItemsToOffers(items, engine.brands), ...engine.catalog],
    brands: engine.brands,
    packages: engine.packages,
    settings: engine.settings,
    quantity: args.quantity,
    mounted: {
      brand: args.requestedBrand,
      model: null,
      size: args.size,
      season: null,
    },
    required: { size: args.size, load: args.load, speed: args.speed },
  });

  const [identical, ...grid] = offers;
  const requested =
    args.requestedBrand && identical
      ? { ...identical, title: `Marque demandée : ${args.requestedBrand}` }
      : null;

  return {
    size: args.size,
    quantity: args.quantity,
    requestedBrand: args.requestedBrand,
    requested,
    grid,
    warning,
  };
}

/** Offres à afficher / imprimer : 6 gammes, plus la marque demandée si présente. */
export function quoteOffers(result: Pick<ManualQuoteResult, "requested" | "grid">): SevenOffer[] {
  return result.requested ? [result.requested, ...result.grid] : result.grid;
}

/* -------------------------------- Historique ------------------------------ */

export async function saveTireQuote(args: {
  form: TireQuoteForm;
  size: string;
  offers: SevenOffer[];
  siteId: string | null;
  siteLabel: string;
  userId: string | null;
  userName: string;
  marginAdjustmentPct?: number;
}): Promise<string | null> {
  const { form } = args;
  const { data, error } = await supabase
    .from("tire_quotes")
    .insert({
      site_id: args.siteId,
      site_label: args.siteLabel,
      user_id: args.userId,
      user_name: args.userName || null,
      size: args.size,
      width: form.width || null,
      height: form.height || null,
      diameter: form.diameter || null,
      load_index: form.load || null,
      speed_index: form.speed || null,
      requested_brand: form.brand.trim() || null,
      customer_name: form.customerName.trim() || null,
      plate: form.plate.trim().toUpperCase() || null,
      vehicle_label: form.vehicleLabel.trim() || null,
      quantity: form.quantity,
      offers: args.offers as never,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data?.id ?? null;
}

export async function fetchTireQuotes(search: string): Promise<TireQuoteRow[]> {
  let q = supabase.from("tire_quotes").select("*").order("created_at", { ascending: false }).limit(60);
  const s = search.trim();
  if (s) {
    const like = `%${s.replace(/[%,]/g, "")}%`;
    q = q.or(`customer_name.ilike.${like},plate.ilike.${like},size.ilike.${like}`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as TireQuoteRow[];
}

export async function fetchTireQuote(id: string): Promise<TireQuoteRow | null> {
  const { data, error } = await supabase.from("tire_quotes").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as TireQuoteRow | null;
}
