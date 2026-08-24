import { supabase } from "@/integrations/supabase/client";
import { GUIDED_ZONES } from "./zones";

/**
 * Règle métier : un dossier (OR / intervention) ne porte qu'un seul Tour Véhicule.
 * Retourne le tour existant s'il y en a déjà un (actif ou clôturé).
 */
export async function findInspectionForOrder(orderId: string) {
  const { data } = await supabase
    .from("vehicle_inspections")
    .select("id, status, archived_at")
    .eq("repair_order_id", orderId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function createInspection(
  orderId: string,
  vehicleId: string,
  type: "libre" | "guide",
  author?: {
    userId?: string | null;
    userName?: string | null;
    siteId?: string | null;
    /** Trace de l'action métier à l'origine du tour (jamais une simple consultation). */
    source?: string | null;
  },
) {
  // Anti-doublon / anti double-clic : on reprend le tour existant.
  const existing = await findInspectionForOrder(orderId);
  if (existing) {
    const { data: full, error: e } = await supabase
      .from("vehicle_inspections")
      .select("*")
      .eq("id", existing.id)
      .single();
    if (e) throw e;
    return full;
  }

  const { data, error } = await supabase
    .from("vehicle_inspections")
    .insert({
      repair_order_id: orderId,
      vehicle_id: vehicleId,
      inspection_type: type,
      created_by: author?.userId ?? null,
      created_by_name: author?.userName ?? null,
      site_id: author?.siteId ?? null,
      creation_source: author?.source ?? "action_operateur",
    })
    .select()
    .single();
  if (error) throw error;

  if (type === "guide") {
    const rows = GUIDED_ZONES.flatMap((zone, zi) =>
      zone.points.map((p) => ({
        inspection_id: data.id,
        zone_key: zone.key,
        zone_label: zone.label,
        zone_index: zi + 1,
        point_key: p.key,
        point_label: p.label,
      })),
    );
    const { error: pErr } = await supabase.from("inspection_points").insert(rows);
    if (pErr) throw pErr;
  }
  return data;
}

export async function saveMileage(opts: {
  vehicleId: string;
  /** Optionnel : une mise à jour kilométrage peut être faite hors tour véhicule. */
  inspectionId?: string | null;
  mileage: number;
  mediaId?: string | null;
  previous?: number | null;
}) {
  await supabase.from("mileage_history").insert({
    vehicle_id: opts.vehicleId,
    inspection_id: opts.inspectionId ?? null,
    mileage: opts.mileage,
    source: opts.inspectionId ? "tour_vehicule" : "mise_a_jour",
    media_id: opts.mediaId ?? null,
  });
  if (opts.inspectionId) {
    await supabase
      .from("vehicle_inspections")
      .update({ mileage: opts.mileage })
      .eq("id", opts.inspectionId);
  }
  await supabase
    .from("vehicles")
    .update({ last_mileage: opts.mileage, last_mileage_at: new Date().toISOString() })
    .eq("id", opts.vehicleId);
  await supabase.from("dms_update_proposals").insert({
    vehicle_id: opts.vehicleId,
    inspection_id: opts.inspectionId ?? null,
    field: "kilometrage",
    old_value: opts.previous != null ? String(opts.previous) : null,
    new_value: String(opts.mileage),
  });
}

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}