/** Création d'une fiche véhicule locale à partir d'un résultat IXELLIO. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function isoDate(fr?: string): string | null {
  if (!fr) return null;
  const m = /^(\d{2})[/-](\d{2})[/-](\d{2,4})$/.exec(fr.trim());
  if (!m) return null;
  const year = m[3]!.length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[2]}-${m[1]}`;
}

function display(plate: string): string {
  const m = /^([A-Z]{2})(\d{3})([A-Z]{2})$/.exec(plate);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : plate;
}

/** Premier entier trouvé dans une valeur texte (« 1 490 kg », « 115 g/km »…). */
function int(v?: string): number | null {
  if (!v) return null;
  const m = /-?\d[\d\s.,]*/.exec(v);
  if (!m) return null;
  const n = Number.parseInt(m[0].replace(/[\s.,]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/** Champs bruts conservés tels que renvoyés par IXELLIO (valeurs ambiguës / unités). */
const RAW_KEYS = [
  "puissanceFiscale",
  "puissanceCh",
  "puissanceKw",
  "poids",
  "ptac",
  "masseVide",
  "co2",
  "cylindree",
] as const;

export async function saveVehicleFromIxellio(
  plate: string,
  v: Record<string, string | undefined>,
): Promise<{ id: string; created: boolean }> {
  const { data: existing } = await supabaseAdmin
    .from("ref_vehicles")
    .select("id")
    .eq("registration_normalized", plate)
    .maybeSingle();

  const raw: Record<string, string> = {};
  for (const k of RAW_KEYS) if (v[k]) raw[k] = v[k]!;

  const row = {
    registration_display: display(plate),
    registration_normalized: plate,
    brand: v["marque"] ?? null,
    model: v["modele"] ?? null,
    version: v["version"] ?? null,
    vin: v["vin"] ?? null,
    vin_normalized: v["vin"]?.toUpperCase() ?? null,
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
    fiscal_power: int(v["puissanceFiscale"]),
    body_type: v["carrosserie"] ?? null,
    vehicle_type: v["genre"] ?? null,
    doors: int(v["portes"]),
    seats: int(v["places"]),
    weight_kg: int(v["poids"]),
    gvw_kg: int(v["ptac"]),
    curb_weight_kg: int(v["masseVide"]),
    co2_g_km: int(v["co2"]),
    first_registration_date: isoDate(v["dateMec"]),
    source_system: "ixellio",
    source_raw: Object.keys(raw).length ? raw : null,
  };

  // On n'écrase jamais une valeur existante avec un null (résultat IXELLIO partiel).
  const patch = Object.fromEntries(
    Object.entries(row).filter(([, val]) => val !== null && val !== undefined),
  );

  let id: string;
  let created: boolean;

  if (existing) {
    await supabaseAdmin.from("ref_vehicles").update(patch).eq("id", existing.id);
    id = existing.id;
    created = false;
  } else {
    const { data, error } = await supabaseAdmin.from("ref_vehicles").insert(row).select("id").single();
    if (error || !data) throw new Error("Enregistrement du véhicule impossible.");
    id = data.id;
    created = true;
  }

  // Relecture de contrôle : on vérifie que chaque champ envoyé est bien mémorisé.
  const { data: saved } = await supabaseAdmin.from("ref_vehicles").select("*").eq("id", id).single();
  const stored = saved as Record<string, unknown> | null;
  const missing = stored
    ? Object.keys(patch).filter((k) => stored[k] === null || stored[k] === undefined)
    : Object.keys(patch);

  return { id, created, storedFields: Object.keys(patch).length - missing.length, missing };
}

