/** Création d'une fiche véhicule locale à partir d'un résultat IXELLIO. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

import { displayPlate, ixellioToRefFields } from "./ixellio-map";

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
): Promise<{ id: string; created: boolean; storedFields: number; missing: string[] }> {
  const { data: existing } = await supabaseAdmin
    .from("ref_vehicles")
    .select("id")
    .eq("registration_normalized", plate)
    .maybeSingle();

  const raw: Record<string, string> = {};
  for (const k of RAW_KEYS) if (v[k]) raw[k] = v[k]!;

  const row = {
    registration_display: displayPlate(plate),
    registration_normalized: plate,
    ...ixellioToRefFields(v),
    vin_normalized: v["vin"]?.toUpperCase() ?? null,
    source_system: "ixellio",
    source_raw: Object.keys(raw).length ? raw : null,
  };

  // On n'écrase jamais une valeur existante avec un null (résultat IXELLIO partiel).
  const patch = Object.fromEntries(
    Object.entries(row).filter(([, val]) => val !== null && val !== undefined),
  ) as Partial<typeof row>;

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
