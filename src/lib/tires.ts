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
import type { CommercialSettings, PricedItem, Priority, ServicePackage } from "./pricing-engine";
import type { TireWheelAi } from "./tire-types";

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
  const { sellHt } = applyMargin(sourceHtOf(offer), settings);
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

/* ========================================================================== */
/*  MODULE PNEUMATIQUES — grille d'usure, sévérité, marques et 7 propositions  */
/* ========================================================================== */

export type BrandTierRow = Database["public"]["Tables"]["tire_brand_tiers"]["Row"];
export type TireQuoteOffer = Database["public"]["Tables"]["tire_quote_offers"]["Row"];

/* ------------------------------ Grille d'usure ---------------------------- */

export type WearGrid = { good: number; soon: number; legal: number };

/** Seuils administrables (Paramétrage → Chiffrage & pneumatiques). */
export function wearGrid(s: CommercialSettings | null): WearGrid {
  return {
    good: Number(s?.tire_depth_good_mm ?? 4),
    soon: Number(s?.tire_depth_soon_mm ?? 3),
    legal: Number(s?.tire_depth_legal_mm ?? 1.6),
  };
}

export type TireGrade = "correct" | "a_prevoir" | "rapide" | "imperatif";

export const GRADE_LABEL: Record<TireGrade, string> = {
  correct: "Pneumatique correct",
  a_prevoir: "Remplacement à prévoir",
  rapide: "Remplacement à prévoir rapidement / urgent",
  imperatif: "Remplacement impératif",
};

const GRADE_ORDER: TireGrade[] = ["correct", "a_prevoir", "rapide", "imperatif"];

export function worstGrade(a: TireGrade, b: TireGrade): TireGrade {
  return GRADE_ORDER.indexOf(a) >= GRADE_ORDER.indexOf(b) ? a : b;
}

/**
 * Grille objective : > good = correct ; [soon ; good] = remplacement à prévoir ;
 * ] legal ; soon [ = rapidement / urgent ; <= legal = impératif.
 * À 4 mm exactement : « Remplacement à prévoir ».
 */
export function gradeFromDepth(depthMm: number | null | undefined, grid: WearGrid): TireGrade | null {
  if (depthMm == null || !Number.isFinite(depthMm)) return null;
  if (depthMm <= grid.legal) return "imperatif";
  if (depthMm < grid.soon) return "rapide";
  if (depthMm <= grid.good) return "a_prevoir";
  return "correct";
}

export type SeverityLevel = "permissif" | "standard" | "severe";

export const SEVERITY_LABEL: Record<SeverityLevel, string> = {
  permissif: "Permissif",
  standard: "Standard",
  severe: "Sévère",
};

export function severityOf(s: CommercialSettings | null): SeverityLevel {
  const v = (s?.ai_severity_level ?? "standard") as SeverityLevel;
  return v === "permissif" || v === "severe" ? v : "standard";
}

function step(grade: TireGrade, by: number): TireGrade {
  const i = Math.min(GRADE_ORDER.length - 1, Math.max(0, GRADE_ORDER.indexOf(grade) + by));
  return GRADE_ORDER[i]!;
}

export type TireJudgement = {
  grade: TireGrade;
  /** Niveau strictement issu de la grille objective (jamais adouci). */
  objectiveGrade: TireGrade | null;
  reasons: string[];
  /** Vrai quand la profondeur n'a pas pu être établie. */
  depthUnknown: boolean;
};

/**
 * Jugement final d'une roue : la grille objective et les dangers manifestes
 * priment toujours ; le niveau de sévérité global ne module que les
 * appréciations subjectives (craquelures, vieillissement, usure irrégulière).
 */
export function judgeTire(ai: Partial<TireWheelAi>, grid: WearGrid, severity: SeverityLevel): TireJudgement {
  const objective = gradeFromDepth(ai.depth_mm ?? null, grid);
  const reasons: string[] = [];
  let grade: TireGrade = objective ?? "correct";

  // Dangers manifestes : jamais atténués par le réglage de sévérité.
  if (ai.bulges) {
    grade = "imperatif";
    reasons.push("Hernie constatée sur le flanc");
  }
  if (ai.cuts) {
    grade = worstGrade(grade, "imperatif");
    reasons.push("Coupure constatée");
  }
  if (ai.sidewall_damage) {
    grade = worstGrade(grade, "rapide");
    reasons.push("Flanc endommagé");
  }
  if (ai.foreign_objects) {
    grade = worstGrade(grade, "rapide");
    reasons.push("Corps étranger visible dans la bande de roulement");
  }

  // Appréciations subjectives : modulées par le niveau de sévérité global.
  const subjective: string[] = [];
  if (ai.cracks) subjective.push("Craquelures relevées");
  if (ai.wear === "irreguliere") subjective.push("Usure irrégulière relevée — contrôle géométrie conseillé");
  if (subjective.length) {
    reasons.push(...subjective);
    if (severity === "severe") grade = worstGrade(grade, step(grade, 1));
    else if (severity === "standard") grade = worstGrade(grade, "a_prevoir");
  }

  return { grade, objectiveGrade: objective, reasons, depthUnknown: ai.depth_mm == null };
}

export function gradeToPriority(grade: TireGrade): Priority {
  if (grade === "imperatif") return "urgent";
  if (grade === "rapide") return "urgent";
  if (grade === "a_prevoir") return "a_remplacer";
  return "a_prevoir";
}

/** Le chiffrage est préparé dès qu'un remplacement est annoncé. */
export function needsQuote(grade: TireGrade): boolean {
  return grade !== "correct";
}

/* --------------------------- Marques par gamme ---------------------------- */

export async function fetchBrandTiers(): Promise<BrandTierRow[]> {
  const { data, error } = await supabase
    .from("tire_brand_tiers")
    .select("*")
    .order("tier")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as BrandTierRow[];
}

export function defaultBrandOf(rows: BrandTierRow[], tier: TireTier): string | null {
  const active = rows.filter((r) => r.tier === tier && r.active);
  return (active.find((r) => r.is_default) ?? active[0])?.brand ?? null;
}

/* ---------------------------- Forfait de montage -------------------------- */

/**
 * Montage : uniquement les forfaits déjà référencés (Renault/Dacia).
 * Aucun prix n'est recréé, aucun équilibrage/valve/recyclage n'est ajouté deux fois.
 */
export function mountPackageFor(
  packages: ServicePackage[],
  quantity: number,
): { label: string; unitTtc: number; totalTtc: number } | null {
  const pool = packages.filter(
    (p) => p.active !== false && /pneu/i.test(`${p.operation_code} ${p.label}`) && p.price_ttc != null,
  );
  if (!pool.length) return null;
  const exact = pool.find((p) => new RegExp(`(^|[^0-9])${quantity}([^0-9]|$)`).test(p.label));
  const chosen = exact ?? pool[0]!;
  const unitTtc = exact ? Number(chosen.price_ttc) / quantity : Number(chosen.price_ttc);
  return {
    label: chosen.label,
    unitTtc: Math.round(unitTtc * 100) / 100,
    totalTtc: Math.round(unitTtc * quantity * 100) / 100,
  };
}

/* ------------------------------ Compatibilité ----------------------------- */

const SPEED_ORDER = "QRSTHVWY";

export type Compatibility = "compatible" | "a_confirmer";

export function checkCompatibility(args: {
  offerSize: string | null;
  offerLoad: string | null;
  offerSpeed: string | null;
  requiredSize: string | null;
  requiredLoad: string | null;
  requiredSpeed: string | null;
}): { status: Compatibility; message: string } {
  const o = normalizeTireSize(args.offerSize);
  const r = normalizeTireSize(args.requiredSize);
  if (!o || !r || o !== r) return { status: "a_confirmer", message: "Compatibilité à confirmer" };

  const ol = Number(args.offerLoad);
  const rl = Number(args.requiredLoad);
  if (Number.isFinite(rl)) {
    if (!Number.isFinite(ol) || ol < rl) return { status: "a_confirmer", message: "Compatibilité à confirmer" };
  }

  const os = (args.offerSpeed ?? "").toUpperCase().slice(0, 1);
  const rs = (args.requiredSpeed ?? "").toUpperCase().slice(0, 1);
  if (rs) {
    if (!os || SPEED_ORDER.indexOf(os) < SPEED_ORDER.indexOf(rs)) {
      return { status: "a_confirmer", message: "Compatibilité à confirmer" };
    }
  }
  return { status: "compatible", message: "Compatible" };
}

/* ---------------------------- Sept propositions --------------------------- */

export type SevenOffer = {
  slot: string;
  kind: "identique" | "gamme";
  title: string;
  tier: TireTier | null;
  season: TireSeason | null;
  available: boolean;
  unavailableReason: string;
  brand: string | null;
  model: string | null;
  size: string | null;
  loadIndex: string | null;
  speedIndex: string | null;
  quantity: number;
  unitSourceHt: number | null;
  marginHt: number | null;
  unitSellHt: number | null;
  tiresHt: number | null;
  tiresTtc: number | null;
  mountLabel: string | null;
  mountTtc: number | null;
  totalHt: number | null;
  totalVat: number | null;
  totalTtc: number | null;
  availability: string | null;
  compatibility: Compatibility;
  compatibilityMessage: string;
  supplier: string | null;
  supplierRef: string | null;
  consultedAt: string | null;
  offerId: string | null;
};

const VAT = 0.2;

/**
 * Base HT d'une offre : les catalogues publics (ex. prix public TTC d'un
 * distributeur en ligne) sont ramenés au HT avant application de la marge
 * paramétrée. Aucun prix n'est inventé.
 */
export function sourceHtOf(offer: Pick<TireOffer, "purchase_price_ht" | "price_kind">): number {
  const raw = Number(offer.purchase_price_ht);
  if (!Number.isFinite(raw)) return 0;
  return offer.price_kind === "public_ttc" ? Math.round((raw / 1.2) * 100) / 100 : raw;
}

function priceOffer(
  offer: TireOffer,
  quantity: number,
  settings: CommercialSettings | null,
  packages: ServicePackage[],
  required: { size: string | null; load: string | null; speed: string | null },
) {
  const sourceHt = sourceHtOf(offer);
  const { sellHt, marginHt } = applyMargin(sourceHt, settings);
  const tiresHt = Math.round(sellHt * quantity * 100) / 100;
  const tiresTtc = Math.round(tiresHt * (1 + VAT) * 100) / 100;
  const mount =
    mountPackageFor(packages, quantity) ??
    (offer.mount_price_ttc != null
      ? {
          label: "Montage catalogue pneumatiques",
          unitTtc: Number(offer.mount_price_ttc),
          totalTtc: Math.round(Number(offer.mount_price_ttc) * quantity * 100) / 100,
        }
      : null);
  const mountTtc = mount?.totalTtc ?? null;
  const totalTtc = mountTtc == null ? tiresTtc : Math.round((tiresTtc + mountTtc) * 100) / 100;
  const totalHt = Math.round((totalTtc / (1 + VAT)) * 100) / 100;
  const compat = checkCompatibility({
    offerSize: offer.size,
    offerLoad: offer.load_index,
    offerSpeed: offer.speed_index,
    requiredSize: required.size,
    requiredLoad: required.load,
    requiredSpeed: required.speed,
  });
  return {
    brand: offer.brand,
    model: offer.model,
    size: offer.size,
    loadIndex: offer.load_index,
    speedIndex: offer.speed_index,
    unitSourceHt: sourceHt,
    marginHt,
    unitSellHt: sellHt,
    tiresHt,
    tiresTtc,
    mountLabel: mount?.label ?? null,
    mountTtc,
    totalHt,
    totalVat: Math.round((totalTtc - totalHt) * 100) / 100,
    totalTtc,
    availability: offer.availability,
    compatibility: compat.status,
    compatibilityMessage: compat.message,
    supplier: offer.supplier_key ?? offer.source,
    supplierRef: offer.supplier_ref,
    consultedAt: offer.price_date,
    offerId: offer.id,
  };
}

/**
 * 1 remplacement à l'identique + 6 alternatives (entrée / milieu / haut × été / 4 saisons).
 * Aucune substitution silencieuse : une gamme sans offre reste affichée « indisponible ».
 */
export function buildSevenOffers(args: {
  offers: TireOffer[];
  brands: BrandTierRow[];
  packages: ServicePackage[];
  settings: CommercialSettings | null;
  quantity: number;
  mounted: { brand: string | null; model: string | null; size: string | null; season: TireSeason | null };
  required: { size: string | null; load: string | null; speed: string | null };
}): SevenOffer[] {
  const { offers, brands, packages, settings, quantity, mounted, required } = args;
  const sizeMatch = (o: TireOffer) =>
    !required.size || !o.size || normalizeTireSize(o.size) === normalizeTireSize(required.size);

  const out: SevenOffer[] = [];

  /* 1. Remplacement à l'identique (même marque/modèle, même saison). */
  const b = (mounted.brand ?? "").toLowerCase();
  const m = (mounted.model ?? "").toLowerCase();
  const identical =
    (b &&
      offers.find(
        (o) =>
          o.active &&
          sizeMatch(o) &&
          o.brand.toLowerCase() === b &&
          (!m || o.model.toLowerCase() === m) &&
          (!mounted.season || o.season === mounted.season),
      )) ||
    (b && offers.find((o) => o.active && sizeMatch(o) && o.brand.toLowerCase() === b)) ||
    null;

  out.push(
    identical
      ? {
          slot: "identique",
          kind: "identique",
          title: "Remplacement à l'identique",
          tier: identical.tier as TireTier,
          season: identical.season as TireSeason,
          available: true,
          unavailableReason: "",
          quantity,
          ...priceOffer(identical, quantity, settings, packages, required),
        }
      : {
          slot: "identique",
          kind: "identique",
          title: "Remplacement à l'identique",
          tier: null,
          season: mounted.season,
          available: false,
          unavailableReason: mounted.brand
            ? `Offre indisponible dans cette marque (${mounted.brand})`
            : "Monte actuelle non identifiée — remplacement à l'identique à confirmer",
          brand: mounted.brand,
          model: mounted.model,
          size: mounted.size ?? required.size,
          loadIndex: required.load,
          speedIndex: required.speed,
          quantity,
          unitSourceHt: null,
          marginHt: null,
          unitSellHt: null,
          tiresHt: null,
          tiresTtc: null,
          mountLabel: null,
          mountTtc: null,
          totalHt: null,
          totalVat: null,
          totalTtc: null,
          availability: null,
          compatibility: "a_confirmer",
          compatibilityMessage: "Compatibilité à confirmer",
          supplier: null,
          supplierRef: null,
          consultedAt: null,
          offerId: null,
        },
  );

  /* 2 à 7. Trois gammes × été et 4 saisons, marque issue du paramétrage global. */
  for (const tier of ["entree", "milieu", "haut"] as TireTier[]) {
    for (const season of ["ete", "quatre_saisons"] as TireSeason[]) {
      const brand = defaultBrandOf(brands, tier);
      const offer =
        offers.find(
          (o) =>
            o.active &&
            sizeMatch(o) &&
            o.tier === tier &&
            o.season === season &&
            (!brand || o.brand.toLowerCase() === brand.toLowerCase()),
        ) ?? null;
      const title = `${TIER_LABEL[tier]} · ${SEASON_LABEL[season]}`;
      if (offer) {
        out.push({
          slot: `${tier}_${season}`,
          kind: "gamme",
          title,
          tier,
          season,
          available: true,
          unavailableReason: "",
          quantity,
          ...priceOffer(offer, quantity, settings, packages, required),
        });
      } else {
        out.push({
          slot: `${tier}_${season}`,
          kind: "gamme",
          title,
          tier,
          season,
          available: false,
          unavailableReason: brand
            ? `Offre indisponible dans cette marque (${brand})`
            : "Aucune marque configurée pour cette gamme",
          brand,
          model: null,
          size: required.size,
          loadIndex: required.load,
          speedIndex: required.speed,
          quantity,
          unitSourceHt: null,
          marginHt: null,
          unitSellHt: null,
          tiresHt: null,
          tiresTtc: null,
          mountLabel: null,
          mountTtc: null,
          totalHt: null,
          totalVat: null,
          totalTtc: null,
          availability: null,
          compatibility: "a_confirmer",
          compatibilityMessage: "Compatibilité à confirmer",
          supplier: null,
          supplierRef: null,
          consultedAt: null,
          offerId: null,
        });
      }
    }
  }

  return out;
}

/** Essieu concerné par une roue (deux pneus par défaut). */
export function axleOf(code: string): { label: string; wheels: string[] } {
  const front = code.includes("av");
  return front
    ? { label: "Essieu avant", wheels: ["avg", "avd"] }
    : { label: "Essieu arrière", wheels: ["arg", "ard"] };
}
