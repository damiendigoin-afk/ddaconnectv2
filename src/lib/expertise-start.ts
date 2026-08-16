import { supabase } from "@/integrations/supabase/client";
import { createExpertise, type Expertise } from "@/lib/expertise";
import { formatPlate, normalizePlate } from "@/lib/plate";
import type { RefPrefill } from "@/lib/refbase";

export type StartContext = {
  siteId?: string | null;
  userId?: string | null;
  userName?: string | null;
};

/**
 * Recherche le véhicule atelier historique (table `vehicles`) correspondant.
 * Absence de correspondance = véhicule de stock / importé : ce n'est PAS une erreur.
 */
async function findLegacyVehicle(plateNormalized: string, vin: string) {
  if (plateNormalized) {
    const { data } = await supabase
      .from("vehicles")
      .select("id, client_id")
      .eq("plate_normalized", plateNormalized)
      .maybeSingle();
    if (data) return data;
  }
  if (vin) {
    const { data } = await supabase.from("vehicles").select("id, client_id").eq("vin", vin).maybeSingle();
    if (data) return data;
  }
  return null;
}

/** Expertises déjà ouvertes pour ce véhicule (proposer d'ouvrir plutôt que dupliquer). */
export async function findOpenExpertise(opts: { refVehicleId?: string | null; plate?: string | null }) {
  let q = supabase
    .from("vehicle_expertises")
    .select("id, plate, status, created_at")
    .neq("status", "envoyee")
    .order("created_at", { ascending: false })
    .limit(1);
  if (opts.refVehicleId) q = q.eq("ref_vehicle_id", opts.refVehicleId);
  else if (opts.plate) q = q.eq("plate", opts.plate);
  else return null;
  const { data } = await q;
  return (data ?? [])[0] ?? null;
}

/**
 * Crée une expertise à partir d'un véhicule connu (référentiel) ou d'une simple plaque.
 * Le client n'est jamais obligatoire : véhicule de stock, VO, entreprise ou sans propriétaire.
 */
export async function startExpertise(
  input: { prefill?: RefPrefill | null; plate?: string },
  ctx: StartContext,
): Promise<Expertise> {
  const f = input.prefill?.fields ?? {};
  const rawPlate = (f["plate"] ?? input.plate ?? "").trim();
  const normalized = normalizePlate(rawPlate);
  const vin = (f["vin"] ?? "").trim();
  const legacy = await findLegacyVehicle(normalized, vin);
  const owner = [f["first_name"], f["last_name"]].filter(Boolean).join(" ").trim();

  return createExpertise({
    expertise_type: "expertise",
    plate: normalized.length >= 5 ? formatPlate(normalized) : rawPlate.toUpperCase() || null,
    // Véhicule atelier historique si connu, sinon rattachement direct au référentiel.
    vehicle_id: legacy?.id ?? null,
    ref_vehicle_id: input.prefill?.vehicleId ?? null,
    // client_id référence les clients atelier ; le client référentiel a sa propre colonne.
    client_id: legacy?.client_id ?? null,
    customer_id: input.prefill?.customerId ?? null,
    vin: vin || null,
    brand: f["brand"] || null,
    model: f["model"] || null,
    first_registration: f["first_registration"] || null,
    mileage: f["mileage"] ? Number(f["mileage"]) : null,
    owner_name: owner || null,
    site_id: ctx.siteId ?? null,
    created_by: ctx.userId ?? null,
    created_by_name: ctx.userName || null,
  });
}

/** Informations non essentielles manquantes : l'expertise démarre quand même. */
export function missingInfo(prefill?: RefPrefill | null): string[] {
  const f = prefill?.fields ?? {};
  const out: string[] = [];
  if (!f["vin"]) out.push("VIN");
  if (!f["brand"] && !f["model"]) out.push("marque/modèle");
  if (!prefill?.customerId) out.push("client");
  if (!f["mileage"]) out.push("kilométrage");
  return out;
}
