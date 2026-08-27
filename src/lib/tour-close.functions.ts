import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({
  inspectionId: z.string().uuid(),
  origin: z.string().url(),
  userName: z.string().max(120).optional(),
  /** Trace de l'action métier ayant clôturé le tour. */
  source: z.string().max(60).optional(),
});

export type CloseTourResult = {
  closed: boolean;
  notified: boolean;
  error: string;
  recipients: string[];
  photoCount: number;
};

/**
 * Clôture d'un Tour Véhicule puis notification Front Office, exécutées côté
 * serveur dans la même requête : la notification ne dépend plus du terminal de
 * l'opérateur. Un échec de notification n'annule jamais la clôture, mais il est
 * journalisé et remonté honnêtement à l'écran.
 */
export const closeTour = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }): Promise<CloseTourResult> => {
    const userName = data.userName?.trim() || "Utilisateur";
    let closed = false;
    try {
      const { error } = await context.supabase.rpc("finish_vehicle_inspection", {
        _inspection_id: data.inspectionId,
        _user_id: context.userId,
        _user_name: userName,
      });
      if (error) {
        return {
          closed: false,
          notified: false,
          error: `Clôture impossible : ${error.message}`,
          recipients: [],
          photoCount: 0,
        };
      }
      closed = true;
      await context.supabase
        .from("vehicle_inspections")
        .update({
          close_source: data.source ?? "bouton_terminer",
          last_modified_at: new Date().toISOString(),
          last_modified_by: context.userId,
          last_modified_by_name: userName,
        })
        .eq("id", data.inspectionId);
    } catch (e) {
      return {
        closed: false,
        notified: false,
        error: `Clôture impossible : ${e instanceof Error ? e.message : String(e)}`,
        recipients: [],
        photoCount: 0,
      };
    }

    try {
      const { notifyTourCompleted } = await import("./tour-notify.server");
      const res = await notifyTourCompleted({
        inspectionId: data.inspectionId,
        origin: data.origin,
        // Clôture automatique : jamais deux notifications pour le même tour.
        skipIfAlreadySent: true,
      });
      return {
        closed,
        notified: res.ok,
        error: res.ok ? "" : (res.error ?? "Notification Front Office impossible"),
        recipients: res.recipients,
        photoCount: res.photoCount,
      };
    } catch (e) {
      console.error("[tour-close] notification impossible", e);
      return {
        closed,
        notified: false,
        error: `Notification Front Office impossible : ${e instanceof Error ? e.message : String(e)}`,
        recipients: [],
        photoCount: 0,
      };
    }
  });
