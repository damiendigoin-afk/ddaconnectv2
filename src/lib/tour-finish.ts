import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { notifyTourFrontOffice } from "@/lib/tour-notify.functions";
import { uploadsFailed, uploadsPending } from "@/lib/upload-tracker";

/**
 * Clôture d'un Tour Véhicule, dans l'ordre imposé :
 * vérification des uploads photo → clôture → notification Front Office
 * (PDF complet généré côté serveur après synchronisation des photos).
 */
export async function finishTour(args: {
  tourId: string;
  userId: string;
  userName: string;
}): Promise<boolean> {
  if (uploadsPending() > 0) {
    toast.error("Envoi de photos en cours. Patientez avant de terminer le Tour.");
    return false;
  }
  if (uploadsFailed() > 0) {
    toast.error(
      "Une ou plusieurs photos n'ont pas été enregistrées. Réessayer avant de terminer le Tour.",
    );
    return false;
  }

  const { error } = await supabase.rpc("finish_vehicle_inspection", {
    _inspection_id: args.tourId,
    _user_id: args.userId,
    _user_name: args.userName || "Utilisateur",
  });
  if (error) {
    toast.error("Le tour n’a pas pu être clôturé.");
    return false;
  }

  try {
    const res = await notifyTourFrontOffice({
      data: { inspectionId: args.tourId, origin: window.location.origin },
    });
    if (res.ok) toast.success(`Front Office notifié (${res.recipients.length} destinataire(s))`);
    else if (res.error) console.warn("[tour] notification Front Office", res.error);
  } catch (e) {
    console.error("[tour] notification Front Office impossible", e);
  }
  return true;
}