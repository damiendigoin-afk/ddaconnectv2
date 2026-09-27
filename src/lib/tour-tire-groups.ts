import { parseTireReference, type SevenOffer, type TireSeason, type TireTier } from "./tires";

export const STANDARD_TIRE_SLOTS = [
  "identique",
  "entree_ete",
  "milieu_ete",
  "haut_ete",
  "entree_quatre_saisons",
  "milieu_quatre_saisons",
  "haut_quatre_saisons",
] as const;

export type StandardTireSlot = (typeof STANDARD_TIRE_SLOTS)[number];
export type TireAxle = "avant" | "arriere";

export type TireGroupInput<T> = {
  axle: TireAxle;
  size: string | null;
  value: T;
};

export type TireGroup<T> = {
  key: "avant" | "arriere" | "quatre";
  axles: TireAxle[];
  size: string | null;
  quantity: 2 | 4;
  values: T[];
};

export function groupTireAxles<T>(entries: TireGroupInput<T>[], allowMerge = true): TireGroup<T>[] {
  const byAxle = new Map<TireAxle, { size: string | null; values: T[] }>();
  for (const entry of entries) {
    const current = byAxle.get(entry.axle) ?? { size: entry.size, values: [] };
    if (!current.size && entry.size) current.size = entry.size;
    current.values.push(entry.value);
    byAxle.set(entry.axle, current);
  }
  const front = byAxle.get("avant");
  const rear = byAxle.get("arriere");
  if (allowMerge && front && rear && front.size && rear.size && normalizedSize(front.size) === normalizedSize(rear.size)) {
    return [{ key: "quatre", axles: ["avant", "arriere"], size: front.size, quantity: 4, values: [...front.values, ...rear.values] }];
  }
  return [
    ...(front ? [{ key: "avant" as const, axles: ["avant" as const], size: front.size, quantity: 2 as const, values: front.values }] : []),
    ...(rear ? [{ key: "arriere" as const, axles: ["arriere" as const], size: rear.size, quantity: 2 as const, values: rear.values }] : []),
  ];
}

function normalizedSize(value: string) {
  return parseTireReference(value).size?.replace(/\s/g, "").toUpperCase() ?? value.replace(/\s/g, "").toUpperCase();
}

export function tireGroupTitle(group: Pick<TireGroup<unknown>, "key" | "size" | "quantity">) {
  const axle = group.key === "quatre" ? "4 PNEUS" : group.key === "avant" ? "PNEUS AV" : "PNEUS AR";
  return `${axle} — ${group.size || "dimension à confirmer"} — ${group.quantity} pneus`;
}

export type TireQuoteChoice = Pick<
  SevenOffer,
  | "slot"
  | "kind"
  | "title"
  | "tier"
  | "season"
  | "available"
  | "unavailableReason"
  | "brand"
  | "model"
  | "size"
  | "loadIndex"
  | "speedIndex"
  | "quantity"
  | "totalHt"
  | "totalTtc"
  | "availability"
  | "compatibility"
  | "compatibilityMessage"
> & { offerRowId?: string | null };

export type TireQuoteComputation = {
  method: "tour_tire_group";
  tire_group: true;
  group_key: TireGroup<unknown>["key"];
  axles: TireAxle[];
  point_ids: string[];
  size: string | null;
  quantity: 2 | 4;
  selected_slot: string | null;
  offers: TireQuoteChoice[];
};

export function isTireQuoteComputation(value: unknown): value is TireQuoteComputation {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return row["tire_group"] === true && Array.isArray(row["offers"]);
}

export function selectedTireChoice(computation: TireQuoteComputation) {
  return computation.offers.find(
    (offer) => offer.slot === computation.selected_slot && offer.available && offer.totalTtc != null,
  ) ?? null;
}

export function placeholderSevenOffers(quantity: 2 | 4, size: string | null): TireQuoteChoice[] {
  const meta: Record<StandardTireSlot, { kind: "identique" | "gamme"; title: string; tier: TireTier | null; season: TireSeason | null }> = {
    identique: { kind: "identique", title: "Équivalence", tier: null, season: null },
    entree_ete: { kind: "gamme", title: "Entrée de gamme · Été", tier: "entree", season: "ete" },
    milieu_ete: { kind: "gamme", title: "Milieu de gamme · Été", tier: "milieu", season: "ete" },
    haut_ete: { kind: "gamme", title: "Haut de gamme · Été", tier: "haut", season: "ete" },
    entree_quatre_saisons: { kind: "gamme", title: "Entrée de gamme · 4 saisons", tier: "entree", season: "quatre_saisons" },
    milieu_quatre_saisons: { kind: "gamme", title: "Milieu de gamme · 4 saisons", tier: "milieu", season: "quatre_saisons" },
    haut_quatre_saisons: { kind: "gamme", title: "Haut de gamme · 4 saisons", tier: "haut", season: "quatre_saisons" },
  };
  return STANDARD_TIRE_SLOTS.map((slot) => ({
    slot,
    ...meta[slot],
    available: false,
    unavailableReason: size ? "Offre indisponible" : "Dimension à confirmer",
    brand: null,
    model: null,
    size,
    loadIndex: null,
    speedIndex: null,
    quantity,
    totalHt: null,
    totalTtc: null,
    availability: null,
    compatibility: "a_confirmer",
    compatibilityMessage: "Compatibilité à confirmer",
  }));
}

export function normalizeSevenChoices(offers: TireQuoteChoice[], quantity: 2 | 4, size: string | null) {
  const bySlot = new Map(offers.map((offer) => [offer.slot, offer]));
  return placeholderSevenOffers(quantity, size).map((fallback) => {
    const found = bySlot.get(fallback.slot);
    return found ? { ...found, quantity } : fallback;
  });
}

export function totalSelectedTireGroups(computations: TireQuoteComputation[]) {
  return computations.reduce((sum, computation) => sum + (selectedTireChoice(computation)?.totalTtc ?? 0), 0);
}