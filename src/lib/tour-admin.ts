/**
 * Gestion d'un Tour Véhicule terminé : modification, archivage, suppression.
 * La date/heure de clôture initiale et l'opérateur de clôture ne sont jamais
 * écrasés : seules les traces de dernière modification sont mises à jour.
 */
import { supabase } from "@/integrations/supabase/client";

export type TourActor = { userId?: string | null; userName?: string | null };

/** Marque le tour comme modifié (et donc « modifié depuis le dernier envoi »). */
export async function markTourModified(tourId: string, actor: TourActor) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("vehicle_inspections")
    .update({
      last_modified_at: now,
      last_modified_by: actor.userId ?? null,
      last_modified_by_name: actor.userName ?? null,
      client_content_updated_at: now,
    })
    .eq("id", tourId);
  if (error) throw error;
}

export async function archiveTour(tourId: string, actor: TourActor) {
  const { error } = await supabase
    .from("vehicle_inspections")
    .update({
      archived_at: new Date().toISOString(),
      archived_by: actor.userId ?? null,
      archived_by_name: actor.userName ?? null,
    })
    .eq("id", tourId);
  if (error) throw error;
}

export async function unarchiveTour(tourId: string) {
  const { error } = await supabase
    .from("vehicle_inspections")
    .update({ archived_at: null, archived_by: null, archived_by_name: null })
    .eq("id", tourId);
  if (error) throw error;
}

/** Suppression définitive : réservée aux managers, double confirmation côté UI. */
export async function deleteTour(tourId: string) {
  const { error } = await supabase.from("vehicle_inspections").delete().eq("id", tourId);
  if (error) throw error;
}
