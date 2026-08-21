/**
 * Pneumatiques — intégré au Tour Véhicule (aucun module séparé).
 *
 * Le chiffrage passe par le moteur central : prix fournisseur + politique
 * commerciale (marge) + montage. La source tarifaire est un adaptateur
 * interchangeable : catalogue local administrable aujourd'hui, API fournisseur
 * réelle demain. Aucun tarif externe n'est simulé.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { CommercialSettings, PricedItem, Priority } from "./pricing-engine";

export type TireOffer = Database["public"]["Tables"]["tire_offers"]["Row"];

export type TireTier = "entree" | "milieu" | "haut";
export type TireSeason = "ete" | "quatre_saisons" | "hiver";

export const TIER_LABEL: Record<TireTier, string> = {
  entree: "Entrée de gamme",
  milieu: "Milieu de gamme",
  haut: "Haut de gamme",
};

export const SEASON_LABEL: Record<TireSeason, string> = {
  ete: "Été",
  quatre_saisons: "4 saisons",
  hiver: "Hiver",
};

/** Références V1 par gamme (le catalogue reste administrable). */
export const REFERENCE_BRANDS: Record<TireTier, string> = {
  entree: "Sailun",
  milieu: "Kleber",
  haut: "Michelin",
};

/* --------------------------- Politique commerciale ------------------------ */

/** Marge appliquée = MAX(prix d'achat × pourcentage ; marge minimale fixe HT). */
export function applyMargin(
  purchaseHt: number,
  settings: Pick<CommercialSettings, "margin_pct" | "min_margin_ht"> | null,
): { sellHt: number; marginHt: number; pct: number; min: number } {
  const pct = Number(settings?.margin_pct ?? 0);
  const min = Number(settings?.min_margin_ht ?? 0);
  const marginHt = Math.max(purchaseHt * (pct / 100), min);
  return {
    sellHt: Math.round((purchaseHt + marginHt) * 100) / 100,
    marginHt: Math.round(marginHt * 100) / 100,
    pct,
    min,
  };
}

/* ------------------------- Adaptateur fournisseur ------------------------- */

export type TireSupplier = {
  key: string;
  label: string;
  configured: boolean;
  /** Retourne les offres disponibles pour une dimension donnée. */
  listOffers: (size: string | null) => Promise<TireOffer[]>;
};

/** Catalogue local administrable (Paramétrage → Chiffrage & pneumatiques). */
export const localCatalogSupplier: TireSupplier = {
  key: "catalogue_local",
  label: "Catalogue local administrable",
  configured: true,
  async listOffers(size) {
    let q = supabase.from("tire_offers").select("*").eq("active", true);
    if (size) q = q.or(`size.eq.${size},size.is.null`);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as TireOffer[];
  },
};

/** Fournisseur externe non encore raccordé : état « non configuré », jamais simulé. */
export function externalSupplier(key: string, label: string): TireSupplier {
  return {
    key,
    label,
    configured: false,
    async listOffers() {
      throw new Error(`${label} : source tarifaire non configurée.`);
    },
  };
}

export const TIRE_SUPPLIERS: TireSupplier[] = [
  localCatalogSupplier,
  externalSupplier("centralepneus", "CentralePneus (accès technique à confirmer)"),
  externalSupplier("api_fournisseur", "API fournisseur (à raccorder)"),
];

export function supplierByKey(key: string | null | undefined): TireSupplier {
  return TIRE_SUPPLIERS.find((s) => s.key === key) ?? localCatalogSupplier;
}

/* ------------------------------ Propositions ------------------------------ */

export type TireProposal = {
  tier: TireTier;
  season: TireSeason;
  brand: string;
  model: string;
  size: string | null;
  quantity: number;
  unitSellHt: number;
  tiresTtc: number;
  mountTtc: number;
  totalTtc: number;
  source: string;
  priceDate: string;
  identical: boolean;
};

export function proposalFromOffer(
  offer: TireOffer,
  quantity: number,
  settings: CommercialSettings | null,
  identical = false,
): TireProposal {
  const { sellHt } = applyMargin(Number(offer.purchase_price_ht), settings);
  const tiresTtc = Math.round(sellHt * 1.2 * quantity * 100) / 100;
  const mountTtc = Math.round(Number(offer.mount_price_ttc) * quantity * 100) / 100;
  return {
    tier: offer.tier as TireTier,
    season: offer.season as TireSeason,
    brand: offer.brand,
    model: offer.model,
    size: offer.size,
    quantity,
    unitSellHt: sellHt,
    tiresTtc,
    mountTtc,
    totalTtc: Math.round((tiresTtc + mountTtc) * 100) / 100,
    source: offer.source,
    priceDate: offer.price_date,
    identical,
  };
}

/**
 * Proposition « monte identique / équivalent direct » + grille de 6 alternatives
 * (Été et 4 saisons × entrée / milieu / haut de gamme).
 */
export function buildTireProposals(args: {
  offers: TireOffer[];
  quantity: number;
  settings: CommercialSettings | null;
  mountedBrand?: string | null;
  mountedModel?: string | null;
}): { identical: TireProposal | null; grid: TireProposal[] } {
  const { offers, quantity, settings } = args;
  const brand = (args.mountedBrand ?? "").toLowerCase();
  const model = (args.mountedModel ?? "").toLowerCase();

  const exact =
    (brand &&
      offers.find(
        (o) =>
          o.brand.toLowerCase() === brand &&
          (!model || o.model.toLowerCase() === model),
      )) ||
    (brand && offers.find((o) => o.brand.toLowerCase() === brand)) ||
    null;

  const grid: TireProposal[] = [];
  for (const season of ["ete", "quatre_saisons"] as TireSeason[]) {
    for (const tier of ["entree", "milieu", "haut"] as TireTier[]) {
      const offer = offers.find((o) => o.season === season && o.tier === tier);
      if (offer) grid.push(proposalFromOffer(offer, quantity, settings));
    }
  }
  return {
    identical: exact ? proposalFromOffer(exact, quantity, settings, true) : null,
    grid,
  };
}

export function tireProposalToItem(p: TireProposal, priority: Priority = "a_remplacer"): PricedItem {
  const totalHt = Math.round((p.totalTtc / 1.2) * 100) / 100;
  return {
    ok: true,
    needsContact: false,
    message: "",
    label: `${p.quantity} pneu${p.quantity > 1 ? "x" : ""} ${p.brand} ${p.model}${p.size ? ` ${p.size}` : ""}`,
    detail: `${SEASON_LABEL[p.season]} · ${TIER_LABEL[p.tier]} · montage inclus`,
    block: "mecanique",
    priority,
    quantity: p.quantity,
    hours: null,
    unitHt: Math.round((p.unitSellHt) * 100) / 100,
    totalHt,
    totalTtc: p.totalTtc,
    source: "prix_fournisseur_pneu",
    confidence: "elevee",
    computation: {
      tires_ttc: p.tiresTtc,
      mount_ttc: p.mountTtc,
      source: p.source,
      price_date: p.priceDate,
      identical: p.identical,
    },
  };
}

/* ------------------------------ Analyse usure ----------------------------- */

export type TireCondition = "bon" | "a_surveiller" | "a_remplacer_prochainement" | "urgent";

export const CONDITION_LABEL: Record<TireCondition, string> = {
  bon: "Bon état",
  a_surveiller: "À surveiller",
  a_remplacer_prochainement: "À remplacer prochainement",
  urgent: "Urgent",
};

export type WearPattern =
  | "reguliere"
  | "importante"
  | "proche_temoin"
  | "au_temoin"
  | "lisse"
  | "interieure"
  | "exterieure"
  | "centrale"
  | "irreguliere";

export const WEAR_LABEL: Record<WearPattern, string> = {
  reguliere: "Usure régulière",
  importante: "Usure importante",
  proche_temoin: "Usure proche du témoin",
  au_temoin: "Usure au témoin",
  lisse: "Pneu lisse",
  interieure: "Usure intérieure",
  exterieure: "Usure extérieure",
  centrale: "Usure centrale",
  irreguliere: "Usure irrégulière",
};

export type TireAnalysis = {
  condition: TireCondition;
  patterns: WearPattern[];
  /** Profondeur en mm uniquement si une réglette était visible sur la photo. */
  depthMm: number | null;
  rulerVisible: boolean;
  confidence: "elevee" | "moyenne" | "faible";
  recommendations: string[];
  usable: boolean;
};

const IRREGULAR: WearPattern[] = ["interieure", "exterieure", "irreguliere"];

/** Recommandations dérivées : jamais de kilométrage restant, jamais de diagnostic péremptoire. */
export function tireRecommendations(a: Pick<TireAnalysis, "patterns" | "condition">): string[] {
  const out: string[] = [];
  if (a.patterns.some((p) => IRREGULAR.includes(p))) {
    out.push("Usure irrégulière détectée — contrôle géométrie conseillé");
  }
  if (a.condition === "urgent" || a.condition === "a_remplacer_prochainement") {
    out.push("Remplacement des pneus à proposer au client");
  }
  return out;
}

export function conditionPriority(c: TireCondition): Priority {
  if (c === "urgent") return "urgent";
  if (c === "a_remplacer_prochainement") return "a_remplacer";
  if (c === "a_surveiller") return "a_surveiller";
  return "a_prevoir";
}

/** Âge du pneu d'après le DOT (semaine + année), utilisé comme alerte. */
export function tireAgeFromDot(dot: string | null | undefined): { years: number; alert: boolean } | null {
  const m = /(\d{2})(\d{2})\s*$/.exec((dot ?? "").trim());
  if (!m) return null;
  const week = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (week < 1 || week > 53 || year > new Date().getFullYear()) return null;
  const years = Math.max(0, new Date().getFullYear() - year);
  return { years, alert: years >= 6 };
}

/* --------------------------- Dimension homologuée ------------------------- */

export type TireSizeCheck = {
  status: "conforme" | "a_verifier" | "inconnue";
  message: string;
};

export function normalizeTireSize(v: string | null | undefined): string {
  return (v ?? "").toUpperCase().replace(/\s+/g, "").replace(/[^0-9A-Z/]/g, "");
}

/**
 * On ne suppose jamais que la monte en place est correcte : la dimension lue au
 * flanc est comparée à la dimension homologuée (WinMotor/Xelio, base technique
 * ou photo de l'étiquette constructeur).
 */
export function checkTireSize(mounted: string | null, homologated: string | null): TireSizeCheck {
  const m = normalizeTireSize(mounted);
  const h = normalizeTireSize(homologated);
  if (!m || !h) {
    return {
      status: "inconnue",
      message: "Dimension homologuée inconnue — photographiez l'étiquette pneumatiques / pressions.",
    };
  }
  if (m === h) return { status: "conforme", message: "Dimension conforme à l'homologation." };
  return {
    status: "a_verifier",
    message: "Dimension montée à vérifier avant chiffrage",
  };
}

/** Nombre de pneus selon le constat (avant = 2, arrière = 2, quatre = 4). */
export function tireQuantity(scope: "avant" | "arriere" | "quatre" | "unite"): number {
  if (scope === "quatre") return 4;
  if (scope === "unite") return 1;
  return 2;
}
