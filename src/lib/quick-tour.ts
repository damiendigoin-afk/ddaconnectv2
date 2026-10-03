import { supabase } from "@/integrations/supabase/client";
import { normalizePlate } from "./plate";
import { nextInternalRef } from "./or-ref";
import { createInspection } from "./tour";
import { findRefVehicleByPlate, refVehicleModel } from "./refbase";

type Author = { userId?: string | null | undefined; userName?: string | null | undefined; siteId?: string | null | undefined };

async function startForOrder(orderId: string, author: Author) {
  const { data, error } = await supabase.from("repair_orders").select("vehicle_id").eq("id", orderId).single();
  if (error || !data) throw error ?? new Error("Intervention introuvable");
  return createInspection(orderId, data.vehicle_id, "guide", { ...author, source: "demarrage_rapide_tour" });
}

/** Démarre immédiatement un tour. Une plaque seule crée un dossier DDA sans OR WinMotor. */
export async function startQuickTour(input: Author & { plate?: string | null; orderId?: string | null }) {
  if (input.orderId) return startForOrder(input.orderId, input);
  const norm = normalizePlate(input.plate ?? "");
  if (!norm) throw new Error("Immatriculation illisible — confirmez-la avant de démarrer.");
  const ref = await findRefVehicleByPlate(norm);
  const identity = ref ? { plate: ref.registration_display || norm, plate_normalized: norm, vin: ref.vin, brand: ref.brand, model: refVehicleModel(ref) || null } : { plate: norm, plate_normalized: norm, vin: null, brand: null, model: null };
  const { data: existing } = await supabase.from("vehicles").select("id").or(`plate_normalized.eq.${norm}${ref?.vin ? `,vin.eq.${ref.vin}` : ""}`).limit(1).maybeSingle();
  let vehicleId = existing?.id ?? null;
  if (vehicleId) {
    if (ref) await supabase.from("vehicles").update(identity).eq("id", vehicleId);
  } else {
    const { data, error } = await supabase.from("vehicles").insert(identity).select("id").single();
    if (error) throw error; vehicleId = data.id;
  }
  const internalRef = await nextInternalRef();
  const { data: order, error } = await supabase.from("repair_orders").insert({
    vehicle_id: vehicleId, site_id: input.siteId ?? null, internal_ref: internalRef,
    or_number: null, record_type: "intervention", or_status: "or_manquant",
    created_by: input.userId ?? null, created_by_name: input.userName ?? null,
  }).select("id").single();
  if (error) throw error;
  return startForOrder(order.id, input);
}