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

export async function saveVehicleFromIxellio(
  plate: string,
  v: Record<string, string | undefined>,
): Promise<{ id: string; created: boolean }> {
  const { data: existing } = await supabaseAdmin
    .from("ref_vehicles")
    .select("id")
    .eq("registration_normalized", plate)
    .maybeSingle();

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
    engine_code: v["codeMoteur"] ?? null,
    engine_size: v["cylindree"] ?? null,
    energy: v["carburant"] ?? null,
    gearbox: v["boite"] ?? null,
    power_hp: v["puissanceCh"] ?? null,
    power_kw: v["puissanceFiscale"] ?? null,
    body_type: v["carrosserie"] ?? null,
    doors: v["portes"] ? Number.parseInt(v["portes"], 10) || null : null,
    seats: v["places"] ? Number.parseInt(v["places"], 10) || null : null,
    first_registration_date: isoDate(v["dateMec"]),
    source_system: "ixellio",
  };

  if (existing) {
    await supabaseAdmin.from("ref_vehicles").update(row).eq("id", existing.id);
    return { id: existing.id, created: false };
  }

  const { data, error } = await supabaseAdmin.from("ref_vehicles").insert(row).select("id").single();
  if (error || !data) throw new Error("Enregistrement du véhicule impossible.");
  return { id: data.id, created: true };
}
