import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { auditReportAuth } from "./report-auth";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({
  inspectionId: z.string().uuid(),
  origin: z.string().url(),
});

/** Notifie le Front Office de la clôture d'un Tour Véhicule (PDF joint). */
export const notifyTourFrontOffice = createServerFn({ method: "POST" })
  .middleware([auditReportAuth, requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }) => {
    try {
      const { authorizeReport } = await import("./report-access.server");
      await authorizeReport(
        { userId: context.userId, supabase: context.supabase },
        data.inspectionId,
        "tour",
      );
      const { notifyTourCompleted } = await import("./tour-notify.server");
      const res = await notifyTourCompleted({ ...data, mode: "manual" });
      return {
        ok: res.ok,
        error: res.ok ? "" : (res.error ?? "Envoi impossible (raison inconnue)"),
        recipients: res.recipients,
        photoCount: res.photoCount,
      };
    } catch (e) {
      console.error("[tour-notify] erreur serveur", e);
      return {
        ok: false,
        error:
          e instanceof Error && "code" in e
            ? e.message
            : "Notification impossible. Réessayez plus tard.",
        recipients: [] as string[],
        photoCount: 0,
      };
    }
  });
