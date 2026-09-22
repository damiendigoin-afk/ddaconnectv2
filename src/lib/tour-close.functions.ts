import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({
  inspectionId: z.string().uuid(),
  origin: z.string().url(),
  userName: z.string().max(120).optional(),
  /** Trace de l'action métier ayant clôturé le tour. */
  source: z.string().max(60).optional(),
  /** Site actif de l'opérateur : sert uniquement à combler un site manquant. */
  siteId: z.string().uuid().nullable().optional(),
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
      // Filet : un tour créé sans site (profil sans site rattaché) reçoit le
      // site actif de l'opérateur à la clôture. Jamais d'écrasement d'un site
      // déjà enregistré.
      if (data.siteId) {
        await context.supabase
          .from("vehicle_inspections")
          .update({ site_id: data.siteId })
          .eq("id", data.inspectionId)
          .is("site_id", null);
      }
    } catch (e) {
      return {
        closed: false,
        notified: false,
        error: `Clôture impossible : ${e instanceof Error ? e.message : String(e)}`,
        recipients: [],
        photoCount: 0,
      };
    }

    // La tentative est journalisée AVANT le chargement du service de
    // notification : si ce dernier échoue (dépendance, PDF, réseau), la panne
    // reste visible dans l'historique du tour au lieu de disparaître.
    const { openTourNotifyAttempt, failTourNotifyAttempt } = await import("./tour-notify-log.server");
    const logId = await openTourNotifyAttempt(data.inspectionId);

    try {
      const { notifyTourCompleted } = await import("./tour-notify.server");
      const res = await notifyTourCompleted({
        inspectionId: data.inspectionId,
        origin: data.origin,
        // Clôture automatique : jamais deux notifications pour le même tour.
        skipIfAlreadySent: true,
        mode: "automatic",
        logId,
      });
      return {
        closed,
        notified: res.ok,
        error: res.ok ? "" : (res.error ?? "Notification Front Office impossible"),
        recipients: res.recipients,
        photoCount: res.photoCount,
      };
    } catch (e) {
      const message = `Notification Front Office impossible : ${e instanceof Error ? e.message : String(e)}`;
      console.error("[tour-close] notification impossible", e);
      // Filet de sécurité : si le service complet (PDF) ne peut pas être chargé
      // ou échoue dans le runtime serveur, le Front Office est tout de même
      // prévenu, avec les mêmes destinataires et la même clé d'idempotence.
      try {
        const { sendTourFallbackNotice } = await import("./tour-notify-fallback.server");
        const fb = await sendTourFallbackNotice({
          inspectionId: data.inspectionId,
          origin: data.origin,
          logId,
          reason: e instanceof Error ? e.message : String(e),
        });
        if (fb.ok) {
          return {
            closed,
            notified: true,
            error: "",
            recipients: fb.recipients,
            photoCount: 0,
          };
        }
        await failTourNotifyAttempt(logId, `${message} — secours : ${fb.error}`);
        return {
          closed,
          notified: false,
          error: `${message} — secours : ${fb.error}`,
          recipients: fb.recipients,
          photoCount: 0,
        };
      } catch (fallbackError) {
        console.error("[tour-close] envoi de secours impossible", fallbackError);
        await failTourNotifyAttempt(logId, message);
        return {
          closed,
          notified: false,
          error: message,
          recipients: [],
          photoCount: 0,
        };
      }
    }
  });
