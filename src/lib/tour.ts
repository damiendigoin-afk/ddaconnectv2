import { supabase } from "@/integrations/supabase/client";
import { GUIDED_ZONES } from "./zones";

export async function createInspection(
  orderId: string,
  vehicleId: string,
  type: "libre" | "guide",
) {
  const { data, error } = await supabase
    .from("vehicle_inspections")
    .insert({ repair_order_id: orderId, vehicle_id: vehicleId, inspection_type: type })
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
  inspectionId: string;
  mileage: number;
  mediaId?: string | null;
  previous?: number | null;
}) {
  await supabase.from("mileage_history").insert({
    vehicle_id: opts.vehicleId,
    inspection_id: opts.inspectionId,
    mileage: opts.mileage,
    source: "tour_vehicule",
    media_id: opts.mediaId ?? null,
  });
  await supabase
    .from("vehicle_inspections")
    .update({ mileage: opts.mileage })
    .eq("id", opts.inspectionId);
  await supabase
    .from("vehicles")
    .update({ last_mileage: opts.mileage, last_mileage_at: new Date().toISOString() })
    .eq("id", opts.vehicleId);
  await supabase.from("dms_update_proposals").insert({
    vehicle_id: opts.vehicleId,
    inspection_id: opts.inspectionId,
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