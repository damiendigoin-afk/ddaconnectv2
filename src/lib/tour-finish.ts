import { toast } from "sonner";

import { closeTour } from "@/lib/tour-close.functions";
import { uploadsFailed, uploadsPending } from "@/lib/upload-tracker";

/**
 * Clôture d'un Tour Véhicule, dans l'ordre imposé :
 * vérification des uploads photo → clôture + notification Front Office
 * exécutées côté serveur (le PDF complet est généré après synchronisation des
 * photos). Aucun message de succès n'est affiché sans confirmation réelle.
 */
export async function finishTour(args: {
  tourId: string;
  userId: string;
  userName: string;
  source?: string;
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

  try {
    const res = await closeTour({
      data: {
        inspectionId: args.tourId,
        origin: window.location.origin,
        userName: args.userName || "Utilisateur",
        source: args.source ?? "bouton_terminer",
      },
    });
    if (!res.closed) {
      toast.error(res.error || "Le tour n’a pas pu être clôturé.");
      return false;
    }
    if (res.notified) {
      toast.success(`Tour terminé — Front Office notifié (${res.recipients.length} destinataire(s))`);
    } else {
      toast.error(
        `Tour terminé — notification Front Office non envoyée. ${res.error}`.trim(),
        { duration: 10_000 },
      );
    }
    return true;
  } catch (e) {
    console.error("[tour] clôture impossible", e);
    toast.error(`Le tour n’a pas pu être clôturé : ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}
