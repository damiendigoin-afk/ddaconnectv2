/** Correspondance IXELLIO → colonnes `ref_vehicles` (partagé client/serveur, sans I/O). */

export function isoDateFr(fr?: string): string | null {
  if (!fr) return null;
  const m = /^(\d{2})[/-](\d{2})[/-](\d{2,4})$/.exec(fr.trim());
  if (!m) return null;
  const year = m[3]!.length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[2]}-${m[1]}`;
}

export function displayPlate(plate: string): string {
  const m = /^([A-Z]{2})(\d{3})([A-Z]{2})$/.exec(plate);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : plate;
}

/** Premier entier trouvé dans une valeur texte (« 1 490 kg », « 115 g/km »…). */
export function firstInt(v?: string): number | null {
  if (!v) return null;
  const m = /-?\d[\d\s.,]*/.exec(v);
  if (!m) return null;
  const n = Number.parseInt(m[0].replace(/[\s.,]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/** Champs techniques véhicule alimentés par IXELLIO (hors immatriculation / source). */
export function ixellioToRefFields(v: Record<string, string | undefined>) {
  return {
    brand: v["marque"] ?? null,
    model: v["modele"] ?? null,
    version: v["version"] ?? null,
    vin: v["vin"] ?? null,
    cnit: v["cnit"] ?? null,
    type_mine: v["typeMine"] ?? null,
    tvv: v["tvv"] ?? null,
    engine_code: v["codeMoteur"] ?? null,
    engine_size: v["cylindree"] ?? null,
    energy: v["carburant"] ?? null,
    gearbox: v["boite"] ?? null,
    gearbox_code: v["codeBoite"] ?? null,
    color: v["couleur"] ?? null,
    // Puissances : jamais de confusion CV fiscaux / ch / kW.
    power_hp: v["puissanceCh"] ?? null,
    power_kw: v["puissanceKw"] ?? null,
    fiscal_power: firstInt(v["puissanceFiscale"]),
    body_type: v["carrosserie"] ?? null,
    vehicle_type: v["genre"] ?? null,
    doors: firstInt(v["portes"]),
    seats: firstInt(v["places"]),
    weight_kg: firstInt(v["poids"]),
    gvw_kg: firstInt(v["ptac"]),
    curb_weight_kg: firstInt(v["masseVide"]),
    co2_g_km: firstInt(v["co2"]),
    first_registration_date: isoDateFr(v["dateMec"]),
  };
}

export type RefFieldKey = keyof ReturnType<typeof ixellioToRefFields>;

export const REF_FIELD_LABELS: Record<RefFieldKey, string> = {
  brand: "Marque",
  model: "Modèle",
  version: "Version",
  vin: "VIN",
  cnit: "CNIT",
  type_mine: "Type mine",
  tvv: "TVV",
  engine_code: "Code moteur",
  engine_size: "Cylindrée",
  energy: "Énergie",
  gearbox: "Boîte",
  gearbox_code: "Code boîte",
  color: "Couleur",
  power_hp: "Puissance (ch)",
  power_kw: "Puissance (kW)",
  fiscal_power: "Puissance fiscale",
  body_type: "Carrosserie",
  vehicle_type: "Genre",
  doors: "Portes",
  seats: "Places",
  weight_kg: "Poids",
  gvw_kg: "PTAC",
  curb_weight_kg: "Masse à vide",
  co2_g_km: "CO2",
  first_registration_date: "1re MEC",
};

const isEmpty = (x: unknown) => x === null || x === undefined || String(x).trim() === "";

export type FillPlan = {
  /** Champs vides dans la fiche, qui seront complétés. */
  toAdd: { key: RefFieldKey; value: string | number }[];
  /** Champs déjà renseignés : jamais remplacés (valeur IXELLIO donnée pour information). */
  kept: { key: RefFieldKey; current: string; proposed: string; same: boolean }[];
  patch: Partial<Record<RefFieldKey, string | number>>;
};

/** Règle « uniquement les champs vides » : aucune valeur existante n'est écrasée. */
export function planFillEmpty(existing: Record<string, unknown>, ixellio: Record<string, string | undefined>): FillPlan {
  const mapped = ixellioToRefFields(ixellio);
  const plan: FillPlan = { toAdd: [], kept: [], patch: {} };
  for (const [k, val] of Object.entries(mapped) as [RefFieldKey, string | number | null][]) {
    if (isEmpty(val)) continue;
    const cur = existing[k];
    if (isEmpty(cur)) {
      plan.toAdd.push({ key: k, value: val! });
      plan.patch[k] = val!;
    } else {
      const same = String(cur).trim().toUpperCase() === String(val).trim().toUpperCase();
      plan.kept.push({ key: k, current: String(cur), proposed: String(val), same });
    }
  }
  return plan;
}
