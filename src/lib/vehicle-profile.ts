/**
 * Profil véhicule normalisé : socle commun du moteur de chiffrage.
 * Les informations proviennent des données déjà connues (OR, OCR, WinMotor,
 * Xelio/IXELLIO, référentiel véhicule) : rien n'est redemandé à l'opérateur.
 */

export type Energy =
  | "essence"
  | "diesel"
  | "hybride"
  | "hybride_rechargeable"
  | "electrique"
  | "inconnu";

export type Segment = "A" | "B" | "C" | "D" | "utilitaire" | "inconnu";

export type VehicleProfile = {
  refVehicleId?: string | null;
  plate?: string | null;
  brand: string;
  model: string;
  version?: string | null;
  energy: Energy;
  segment: Segment;
  firstRegistrationDate?: string | null;
  mileage?: number | null;
  homologatedTireSize?: string | null;
};

const ENERGY_RULES: [RegExp, Energy][] = [
  [/(hybride\s*rechargeable|plug[- ]?in|phev|e[- ]?tech\s*plug)/i, "hybride_rechargeable"],
  [/(electri|ev\b|bev|zoe|megane e|scenic e)/i, "electrique"],
  [/(hybrid|hev|e[- ]?tech)/i, "hybride"],
  [/(diesel|gazole|gasoil|dci|blue ?dci|hdi|tdi|\bgo\b|\bd\b)/i, "diesel"],
  [/(essence|petrol|gasoline|tce|sce|gpl|\bes\b)/i, "essence"],
];

export function normalizeEnergy(raw: string | null | undefined): Energy {
  const v = (raw ?? "").trim();
  if (!v) return "inconnu";
  for (const [re, energy] of ENERGY_RULES) if (re.test(v)) return energy;
  return "inconnu";
}

/** Segments déduits du modèle : aucune tranche d'âge, aucune saisie supplémentaire. */
const SEGMENT_MODELS: Record<string, Segment> = {
  twingo: "A",
  spring: "A",
  clio: "B",
  captur: "B",
  zoe: "B",
  sandero: "B",
  logan: "B",
  jogger: "C",
  modus: "B",
  megane: "C",
  scenic: "C",
  kangoo: "utilitaire",
  duster: "C",
  arkana: "C",
  austral: "C",
  kadjar: "C",
  bigster: "C",
  talisman: "D",
  espace: "D",
  koleos: "D",
  laguna: "D",
  rafale: "D",
  trafic: "utilitaire",
  master: "utilitaire",
  express: "utilitaire",
  dokker: "utilitaire",
};

const SEGMENT_KEYWORDS: [RegExp, Segment][] = [
  [/(fourgon|van|utilitaire|combi|transporter|ducato|jumpy|boxer|vito|sprinter|crafter|partner|berlingo|caddy)/i, "utilitaire"],
  [/(up!|108|107|aygo|c1|panda|ka\b|fortwo|forfour|twingo)/i, "A"],
  [/(208|corsa|polo|fiesta|ibiza|fabia|yaris|micra|swift|c3|500\b|mii|i20|rio)/i, "B"],
  [/(308|astra|golf|focus|leon|octavia|corolla|civic|c4|i30|ceed|3008|2008|qashqai|tucson|sportage|kuga|tiguan)/i, "C"],
  [/(508\b|insignia|passat|mondeo|superb|camry|5008|x3\b|q5|série 3|classe c|talisman)/i, "D"],
];

export function deduceSegment(model: string | null | undefined, version?: string | null): Segment {
  const hay = `${model ?? ""} ${version ?? ""}`.trim().toLowerCase();
  if (!hay) return "inconnu";
  for (const [key, seg] of Object.entries(SEGMENT_MODELS)) {
    if (hay.includes(key)) return seg;
  }
  for (const [re, seg] of SEGMENT_KEYWORDS) if (re.test(hay)) return seg;
  return "inconnu";
}

export function isGroupBrand(brand: string | null | undefined): boolean {
  return /^(renault|dacia|alpine)$/i.test((brand ?? "").trim());
}

export function vehicleYear(profile: Pick<VehicleProfile, "firstRegistrationDate">): number | null {
  const d = profile.firstRegistrationDate;
  if (!d) return null;
  const y = Number(String(d).slice(0, 4));
  return Number.isFinite(y) && y > 1950 ? y : null;
}

/** Un véhicule très ancien, sportif ou rare sort du périmètre de chiffrage automatique. */
export function isAtypical(profile: VehicleProfile): boolean {
  const y = vehicleYear(profile);
  if (y != null && new Date().getFullYear() - y > 25) return true;
  const hay = `${profile.brand} ${profile.model} ${profile.version ?? ""}`.toLowerCase();
  return /(alpine|ferrari|porsche|lamborghini|maserati|bentley|aston|tesla model s|gt3|rs\b|amg|\bm3\b|\bm5\b|abarth|type r|cupra\b)/i.test(hay);
}

/** Opérations incompatibles avec l'énergie du véhicule (jamais proposées). */
const ENERGY_INCOMPATIBILITY: { op: RegExp; forbidden: Energy[]; reason: string }[] = [
  { op: /(vidange|huile_moteur|filtre_huile|revision)/, forbidden: ["electrique"], reason: "Véhicule électrique : pas de vidange moteur." },
  { op: /(filtre_gazole|filtre_carburant_diesel|fap|adblue|injecteur_diesel)/, forbidden: ["essence", "hybride", "electrique"], reason: "Opération réservée aux motorisations diesel." },
  { op: /(bougie_allumage|filtre_air_essence)/, forbidden: ["diesel", "electrique"], reason: "Opération réservée aux motorisations essence." },
  { op: /(courroie_distribution|distribution)/, forbidden: ["electrique"], reason: "Véhicule électrique : pas de distribution moteur." },
  { op: /(embrayage)/, forbidden: ["electrique"], reason: "Véhicule électrique : pas d'embrayage classique." },
];

export function operationCompatibility(
  operationCode: string,
  energy: Energy,
): { compatible: boolean; reason?: string } {
  for (const rule of ENERGY_INCOMPATIBILITY) {
    if (rule.op.test(operationCode) && rule.forbidden.includes(energy)) {
      return { compatible: false, reason: rule.reason };
    }
  }
  return { compatible: true };
}

export function buildVehicleProfile(input: {
  refVehicleId?: string | null;
  plate?: string | null;
  brand?: string | null;
  model?: string | null;
  version?: string | null;
  energy?: string | null;
  segment?: string | null;
  firstRegistrationDate?: string | null;
  mileage?: number | null;
  homologatedTireSize?: string | null;
}): VehicleProfile {
  const segment = (input.segment as Segment | undefined) ?? deduceSegment(input.model, input.version);
  return {
    refVehicleId: input.refVehicleId ?? null,
    plate: input.plate ?? null,
    brand: (input.brand ?? "").trim(),
    model: (input.model ?? "").trim(),
    version: input.version ?? null,
    energy: normalizeEnergy(input.energy),
    segment: segment && segment !== ("" as Segment) ? segment : "inconnu",
    firstRegistrationDate: input.firstRegistrationDate ?? null,
    mileage: input.mileage ?? null,
    homologatedTireSize: input.homologatedTireSize ?? null,
  };
}
