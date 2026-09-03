/**
 * MOTEUR CENTRAL DE CHIFFRAGE — DDA Connect.
 *
 * Tous les modules (Tour Véhicule, Expertise, entretien prévisionnel, devis,
 * carrosserie légère, pneumatiques) appellent ce service : une même anomalie
 * produit le même prix partout. Aucun taux n'est codé en dur : tout provient de
 * la grille tarifaire active, du référentiel de forfaits et des règles peinture,
 * tous administrables dans Paramétrage.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  fetchActiveGrid,
  igpRate,
  laborRate,
  rateOf,
  snapshotOf,
  COLORIMETRY_HOURS,
  DEFAULT_TECHNICAL_RATE_CODE,
  type PaintType,
  type PricingContext,
  type PricingRate,
} from "./pricing";
import {
  isAtypical,
  isGroupBrand,
  operationCompatibility,
  vehicleYear,
  type VehicleProfile,
} from "./vehicle-profile";

export const CONTACT_US = "Nous contacter pour le devis";
export const BODYSHOP_CHECK = "Contrôle carrossier nécessaire";

export type ServicePackage = Database["public"]["Tables"]["service_packages"]["Row"];
export type PaintElementRule = Database["public"]["Tables"]["paint_element_rules"]["Row"];
export type CommercialSettings = Database["public"]["Tables"]["commercial_settings"]["Row"];

export type PriceSource =
  | "forfait_renault"
  | "forfait_dacia"
  | "equivalent_multimarques"
  | "calcul_carrosserie"
  | "prix_fournisseur_pneu"
  | "grille_atelier"
  | "saisie_manuelle";

export type Confidence = "elevee" | "moyenne" | "faible";
export type Priority = "urgent" | "a_remplacer" | "conseille" | "a_surveiller" | "a_prevoir";
export type QuoteBlock = "mecanique" | "carrosserie" | "esthetique";

export const SOURCE_LABEL: Record<PriceSource, string> = {
  forfait_renault: "Forfait Renault exact",
  forfait_dacia: "Forfait Dacia exact",
  equivalent_multimarques: "Équivalent multi-marques",
  calcul_carrosserie: "Calcul carrosserie",
  prix_fournisseur_pneu: "Prix fournisseur pneu",
  grille_atelier: "Grille atelier",
  saisie_manuelle: "Saisie manuelle",
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  elevee: "Confiance élevée",
  moyenne: "Confiance moyenne",
  faible: "Confiance faible",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: "Urgent",
  a_remplacer: "À remplacer",
  conseille: "Conseillé",
  a_surveiller: "À surveiller",
  a_prevoir: "À prévoir",
};

export const BLOCK_LABEL: Record<QuoteBlock, string> = {
  mecanique: "Mécanique",
  carrosserie: "Carrosserie",
  esthetique: "Esthétique",
};

/** Statuts de qualification d'un organe, communs Tour Véhicule / Expertise. */
export const DEFECT_STATUSES = [
  { key: "ok", label: "OK", priority: null },
  { key: "a_surveiller", label: "À surveiller", priority: "a_surveiller" as Priority },
  { key: "a_prevoir", label: "À prévoir", priority: "a_prevoir" as Priority },
  { key: "a_remplacer", label: "À remplacer", priority: "a_remplacer" as Priority },
  { key: "urgent", label: "Urgent / défaut", priority: "urgent" as Priority },
] as const;

export type PricedItem = {
  ok: boolean;
  needsContact: boolean;
  message: string;
  label: string;
  detail: string;
  block: QuoteBlock;
  priority: Priority;
  quantity: number;
  hours: number | null;
  unitHt: number | null;
  totalHt: number;
  totalTtc: number;
  source: PriceSource;
  confidence: Confidence;
  computation: Record<string, unknown>;
  /** Point du Tour Véhicule / de l'expertise à l'origine de la ligne. */
  originPointKey?: string | null;
};

export type EngineContext = {
  pricing: PricingContext | null;
  packages: ServicePackage[];
  paintRules: PaintElementRule[];
  settings: CommercialSettings | null;
};

/* ------------------------------ Chargement ------------------------------- */

export async function loadEngineContext(at: Date = new Date()): Promise<EngineContext> {
  const [pricing, packages, paintRules, settings] = await Promise.all([
    fetchActiveGrid(at),
    supabase.from("service_packages").select("*").eq("active", true),
    supabase.from("paint_element_rules").select("*").eq("active", true),
    supabase.from("commercial_settings").select("*").limit(1).maybeSingle(),
  ]);
  return {
    pricing,
    packages: (packages.data ?? []) as ServicePackage[],
    paintRules: (paintRules.data ?? []) as PaintElementRule[],
    settings: (settings.data ?? null) as CommercialSettings | null,
  };
}

/** Instantané des règles et taux : un devis historique n'est jamais recalculé. */
export function engineSnapshot(ctx: EngineContext) {
  return {
    captured_at: new Date().toISOString(),
    rates: ctx.pricing ? snapshotOf(ctx.pricing) : null,
    paint_rules: ctx.paintRules.map((r) => ({
      element_key: r.element_key,
      element_size: r.element_size,
      paint_hours: Number(r.paint_hours),
      repair_hours_default: Number(r.repair_hours_default),
      dr_operations: r.dr_operations,
    })),
    commercial: ctx.settings
      ? { margin_pct: Number(ctx.settings.margin_pct), min_margin_ht: Number(ctx.settings.min_margin_ht) }
      : null,
  };
}

/* -------------------------------- Helpers -------------------------------- */

const round = (v: number) => Math.round(v * 100) / 100;

export function contactItem(args: {
  label: string;
  block: QuoteBlock;
  priority?: Priority;
  detail?: string;
  reason?: string;
  bodyshopCheck?: boolean;
  originPointKey?: string | null;
}): PricedItem {
  return {
    ok: false,
    needsContact: true,
    message: args.bodyshopCheck ? BODYSHOP_CHECK : CONTACT_US,
    label: args.label,
    detail: args.detail ?? args.reason ?? "",
    block: args.block,
    priority: args.priority ?? "a_prevoir",
    quantity: 1,
    hours: null,
    unitHt: null,
    totalHt: 0,
    totalTtc: 0,
    source: "saisie_manuelle",
    confidence: "faible",
    computation: { reason: args.reason ?? "chiffrage_non_fiable", method: "contact_operateur" },
    originPointKey: args.originPointKey ?? null,
  };
}

function rates(ctx: EngineContext): PricingRate[] {
  return ctx.pricing?.rates ?? [];
}

/* --------------------------- Forfaits mécaniques -------------------------- */

type PackageMatch = { pkg: ServicePackage; source: PriceSource; confidence: Confidence };

/**
 * Recherche du forfait le plus précis : marque exacte + modèle + motorisation +
 * millésime. Pour les autres marques, aucun « forfait maison » n'est inventé :
 * on retient un forfait Renault/Dacia comparable (segment + génération + énergie).
 */
export function findPackage(
  ctx: EngineContext,
  operationCode: string,
  vehicle: VehicleProfile,
): PackageMatch | null {
  const year = vehicleYear(vehicle);
  const pool = ctx.packages.filter((p) => p.operation_code === operationCode);
  if (!pool.length) return null;

  const energyOk = (p: ServicePackage) =>
    !p.energies?.length || p.energies.includes(vehicle.energy);
  const yearOk = (p: ServicePackage) =>
    year == null || ((p.year_from ?? 0) <= year && (p.year_to ?? 9999) >= year);

  const model = vehicle.model.toLowerCase();
  const brandOk = (p: ServicePackage) => p.brand.toLowerCase() === vehicle.brand.toLowerCase();
  const exactSource: PriceSource = /dacia/i.test(vehicle.brand) ? "forfait_dacia" : "forfait_renault";

  if (isGroupBrand(vehicle.brand)) {
    const exact = pool.find(
      (p) => brandOk(p) && (p.model ?? "").toLowerCase() === model && energyOk(p) && yearOk(p),
    );
    if (exact) return { pkg: exact, source: exactSource, confidence: "elevee" };
    const bySegment = pool.find(
      (p) => brandOk(p) && p.segment === vehicle.segment && energyOk(p) && yearOk(p),
    );
    if (bySegment) return { pkg: bySegment, source: exactSource, confidence: "moyenne" };
  }

  // Équivalence multi-marques : segment déduit + génération proche + motorisation.
  if (vehicle.segment === "inconnu") return null;
  const equivalent = pool.find(
    (p) => p.segment === vehicle.segment && energyOk(p) && yearOk(p),
  );
  if (equivalent) return { pkg: equivalent, source: "equivalent_multimarques", confidence: "moyenne" };
  return null;
}

/* --------------------------- Forfaits batterie ---------------------------- */

const BATTERY_RE = /batter/i;

export type BatteryPackageSearch = {
  best: PackageMatch | null;
  /** Forfaits batterie plausibles (triés du plus pertinent au moins pertinent). */
  candidates: ServicePackage[];
  /** true quand plusieurs forfaits sont également plausibles (choix manuel). */
  ambiguous: boolean;
};

/**
 * Recherche d'un forfait batterie dans le référentiel importé (mémentos
 * Renault/Dacia). Les codes opération des mémentos ne sont pas normalisés
 * (RMPNxx…), le rattachement se fait donc sur le libellé + la marque + le
 * modèle/segment quand ces informations existent.
 */
export function findBatteryPackages(
  ctx: EngineContext,
  vehicle: VehicleProfile,
): BatteryPackageSearch {
  const pool = ctx.packages.filter(
    (p) =>
      p.active !== false &&
      (BATTERY_RE.test(p.label ?? "") ||
        BATTERY_RE.test(p.operation_code ?? "") ||
        BATTERY_RE.test(p.notes ?? "")),
  );
  if (!pool.length) return { best: null, candidates: [], ambiguous: false };

  const year = vehicleYear(vehicle);
  const brand = (vehicle.brand ?? "").toLowerCase();
  const model = (vehicle.model ?? "").toLowerCase();

  const score = (p: ServicePackage) => {
    let s = 0;
    const pBrand = (p.brand ?? "").toLowerCase();
    if (pBrand && brand && pBrand === brand) s += 4;
    else if (pBrand && brand && isGroupBrand(vehicle.brand) && isGroupBrand(p.brand)) s += 2;
    const pModel = (p.model ?? "").toLowerCase();
    if (pModel && model && (model.includes(pModel) || pModel.includes(model))) s += 4;
    else if (!pModel) s += 1; // forfait générique toutes gammes
    if (p.segment && vehicle.segment !== "inconnu" && p.segment === vehicle.segment) s += 2;
    if (!p.energies?.length || p.energies.includes(vehicle.energy)) s += 1;
    if (year == null || ((p.year_from ?? 0) <= year && (p.year_to ?? 9999) >= year)) s += 1;
    if (Number(p.price_ttc ?? 0) > 0 || Number(p.hours ?? 0) > 0) s += 1;
    return s;
  };

  const ranked = [...pool].sort((a, b) => score(b) - score(a));
  const top = ranked[0]!;
  const topScore = score(top);
  const ties = ranked.filter((p) => score(p) === topScore);
  const priced = ranked.filter((p) => Number(p.price_ttc ?? 0) > 0 || Number(p.hours ?? 0) > 0);
  const ambiguous = ties.length > 1;

  const source: PriceSource = /dacia/i.test(top.brand ?? "")
    ? "forfait_dacia"
    : /renault/i.test(top.brand ?? "")
      ? "forfait_renault"
      : "equivalent_multimarques";

  const bestPkg = Number(top.price_ttc ?? 0) > 0 || Number(top.hours ?? 0) > 0 ? top : (priced[0] ?? null);
  return {
    best: bestPkg
      ? { pkg: bestPkg, source, confidence: ambiguous ? "moyenne" : "elevee" }
      : null,
    candidates: ranked,
    ambiguous,
  };
}

/** Transforme un forfait du référentiel en ligne de devis chiffrée. */
export function packageItem(
  ctx: EngineContext,
  match: PackageMatch,
  opts: {
    label?: string;
    priority?: Priority;
    detail?: string;
    quantity?: number;
    message?: string;
    originPointKey?: string | null;
    extraComputation?: Record<string, unknown>;
  } = {},
): PricedItem {
  const p = match.pkg;
  const quantity = opts.quantity ?? 1;
  const rate = laborRate(rates(ctx), p.rate_code || DEFAULT_TECHNICAL_RATE_CODE);
  const hours = p.hours == null ? null : Number(p.hours);
  const parts = Number(p.parts_ht ?? 0);
  const ht = p.price_ttc != null ? round(Number(p.price_ttc) / 1.2) : round((hours ?? 0) * rate.ht + parts);
  const ttc =
    p.price_ttc != null ? round(Number(p.price_ttc)) : round((hours ?? 0) * rate.ttc + parts * 1.2);
  return {
    ok: true,
    needsContact: false,
    message: opts.message ?? "",
    label: p.label || opts.label || p.operation_code,
    detail: opts.detail ?? p.notes ?? "",
    block: "mecanique",
    priority: opts.priority ?? "conseille",
    quantity,
    hours,
    unitHt: ht,
    totalHt: round(ht * quantity),
    totalTtc: round(ttc * quantity),
    source: match.source,
    confidence: match.confidence,
    computation: {
      package_id: p.id,
      package_label: p.label,
      operation_code: p.operation_code,
      rate_code: p.rate_code,
      hours,
      parts_ht: parts,
      labor_included: hours != null && hours > 0,
      ...(opts.extraComputation ?? {}),
    },
    originPointKey: opts.originPointKey ?? null,
  };
}


export type MechanicalRequest = {
  operationCode: string;
  label?: string;
  vehicle: VehicleProfile;
  priority?: Priority;
  quantity?: number;
  detail?: string;
};

/**
 * Chiffrage mécanique : forfait référentiel prioritaire, sinon prestation de la
 * grille atelier (géométrie, clim, diagnostic…), sinon « Nous contacter ».
 */
export function priceMechanical(ctx: EngineContext, req: MechanicalRequest): PricedItem {
  const label = req.label ?? req.operationCode;
  const priority = req.priority ?? "conseille";
  const quantity = req.quantity ?? 1;

  const compat = operationCompatibility(req.operationCode, req.vehicle.energy);
  if (!compat.compatible) {
    return contactItem({ label, block: "mecanique", priority, reason: compat.reason ?? "" });
  }
  if (isAtypical(req.vehicle)) {
    return contactItem({
      label,
      block: "mecanique",
      priority,
      reason: "Véhicule atypique, ancien ou haut de gamme : chiffrage à confirmer par l'atelier.",
    });
  }

  const match = findPackage(ctx, req.operationCode, req.vehicle);
  if (match) {
    const p = match.pkg;
    const rate = laborRate(rates(ctx), p.rate_code || DEFAULT_TECHNICAL_RATE_CODE);
    const hours = p.hours == null ? null : Number(p.hours);
    const parts = Number(p.parts_ht ?? 0);
    const ht =
      p.price_ttc != null ? round(Number(p.price_ttc) / 1.2) : round((hours ?? 0) * rate.ht + parts);
    const ttc = p.price_ttc != null ? round(Number(p.price_ttc)) : round((hours ?? 0) * rate.ttc + parts * 1.2);
    return {
      ok: true,
      needsContact: false,
      message: "",
      label: p.label || label,
      detail: req.detail ?? p.notes ?? "",
      block: "mecanique",
      priority,
      quantity,
      hours,
      unitHt: ht,
      totalHt: round(ht * quantity),
      totalTtc: round(ttc * quantity),
      source: match.source,
      confidence: match.confidence,
      computation: {
        package_id: p.id,
        operation_code: p.operation_code,
        rate_code: p.rate_code,
        hours,
        parts_ht: parts,
      },
    };
  }

  // Prestation forfaitaire de la grille atelier (géométrie, clim, diagnostic…).
  const service = rateOf(rates(ctx), req.operationCode);
  if (service && (service.ht || service.ttc)) {
    return {
      ok: true,
      needsContact: false,
      message: "",
      label,
      detail: req.detail ?? "",
      block: "mecanique",
      priority,
      quantity,
      hours: null,
      unitHt: service.ht,
      totalHt: round(service.ht * quantity),
      totalTtc: round(service.ttc * quantity),
      source: "grille_atelier",
      confidence: "elevee",
      computation: { rate_code: req.operationCode },
    };
  }

  return contactItem({
    label,
    block: "mecanique",
    priority,
    reason: "Aucun forfait fiable disponible pour cette opération.",
  });
}

/* ---------------------------- Carrosserie V1 ------------------------------ */

export type DamageSeverity = "leger" | "modere" | "lourd";

export const BODY_ELEMENTS = [
  "retroviseur",
  "aile_avant",
  "porte_avant",
  "porte_arriere",
  "aile_arriere",
  "capot",
  "hayon",
  "bouclier_avant",
  "bouclier_arriere",
  "bas_de_caisse",
] as const;

export type BodyRequest = {
  elementKey: string;
  severity: DamageSeverity;
  paintType: PaintType;
  /** Nombre d'interventions peinture (1 h de colorimétrie chacune, pas par élément). */
  interventions?: number;
  /** Temps de réparation, distinct du temps peinture, toujours modifiable. */
  repairHours?: number;
  paintHours?: number;
  drCodes?: string[];
  priority?: Priority;
  laborCode?: string;
  structural?: boolean;
};

/**
 * Carrosserie V1 : uniquement l'esthétique légère à modérée. Choc lourd,
 * structure ou remplacement d'élément soudé → contrôle carrossier.
 */
export function priceBodywork(ctx: EngineContext, req: BodyRequest): PricedItem {
  const rule = ctx.paintRules.find((r) => r.element_key === req.elementKey);
  const label = rule?.label ?? req.elementKey;
  const priority = req.priority ?? "conseille";

  if (req.severity === "lourd" || req.structural) {
    return contactItem({
      label,
      block: "carrosserie",
      priority,
      bodyshopCheck: true,
      reason: "Dégât important, structure ou élément soudé : hors chiffrage automatique.",
    });
  }
  if (!rule) {
    return contactItem({
      label,
      block: "carrosserie",
      priority,
      reason: "Élément non reconnu : validation opérateur nécessaire.",
    });
  }

  const labor = laborRate(rates(ctx), req.laborCode ?? DEFAULT_TECHNICAL_RATE_CODE);
  const igp = igpRate(rates(ctx), req.paintType);
  const paintHours = req.paintHours ?? Number(rule.paint_hours);
  const repairHours = req.repairHours ?? Number(rule.repair_hours_default);
  const interventions = req.interventions ?? 1;
  const colorimetryHours = COLORIMETRY_HOURS * interventions;
  const drOps =
    (rule.dr_operations as { code: string; label: string; hours: number | null }[] | null) ?? [];
  const selectedDr = req.drCodes
    ? drOps.filter((o) => req.drCodes?.includes(o.code))
    : drOps;
  // Temps D/R non figés : tant qu'aucun barème n'est validé, les heures restent nulles
  // et n'entrent pas dans le calcul ; l'opération reste listée comme à paramétrer.
  const pendingDr = selectedDr.filter((o) => o.hours == null || Number.isNaN(Number(o.hours)));
  const drHours = selectedDr.reduce(
    (s, o) => s + (o.hours == null ? 0 : Number(o.hours) || 0),
    0,
  );


  const laborHours = repairHours + paintHours + colorimetryHours + drHours;
  const igpHours = paintHours + colorimetryHours;
  const totalHt = round(laborHours * labor.ht + igpHours * igp.ht);
  const totalTtc = round(laborHours * labor.ttc + igpHours * igp.ttc);

  return {
    ok: true,
    needsContact: false,
    message: "",
    label,
    detail: `${rule.element_size === "gros" ? "Gros élément" : rule.element_size === "moyen" ? "Élément moyen" : "Petit élément"} · réparation ${repairHours} h · peinture ${paintHours} h${
      pendingDr.length
        ? ` · à paramétrer : ${pendingDr.map((o) => o.label).join(", ")} (temps non renseigné)`
        : ""
    }`,
    block: "carrosserie",
    priority,
    quantity: 1,
    hours: round(laborHours),
    unitHt: totalHt,
    totalHt,
    totalTtc,
    source: "calcul_carrosserie",
    confidence: pendingDr.length ? "moyenne" : req.severity === "leger" ? "elevee" : "moyenne",
    computation: {
      element_key: rule.element_key,
      element_size: rule.element_size,
      repair_hours: repairHours,
      paint_hours: paintHours,
      colorimetry_hours: colorimetryHours,
      dr: selectedDr,
      dr_pending: pendingDr.map((o) => o.code),
      igp_hours: igpHours,
      labor_rate_ht: labor.ht,
      igp_rate_ht: igp.ht,
      paint_type: req.paintType,
    },

  };
}

/* -------------------------- Totaux et présentation ------------------------ */

export function blockTotals(items: PricedItem[]) {
  const blocks: Record<QuoteBlock, { items: PricedItem[]; ht: number; ttc: number }> = {
    mecanique: { items: [], ht: 0, ttc: 0 },
    carrosserie: { items: [], ht: 0, ttc: 0 },
    esthetique: { items: [], ht: 0, ttc: 0 },
  };
  for (const it of items) {
    const b = blocks[it.block];
    b.items.push(it);
    b.ht = round(b.ht + it.totalHt);
    b.ttc = round(b.ttc + it.totalTtc);
  }
  return {
    blocks,
    totalHt: round(items.reduce((s, i) => s + i.totalHt, 0)),
    totalTtc: round(items.reduce((s, i) => s + i.totalTtc, 0)),
    pendingContact: items.filter((i) => i.needsContact).length,
  };
}

export function euroTtc(v: number | null | undefined): string {
  if (v == null) return CONTACT_US;
  return `${Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € TTC`;
}
