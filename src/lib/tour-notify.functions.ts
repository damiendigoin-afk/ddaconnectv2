import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({
  inspectionId: z.string().uuid(),
  origin: z.string().url(),
});

/** Notifie le Front Office de la clôture d'un Tour Véhicule (PDF joint). */
export const notifyTourFrontOffice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data }) => {
    const { notifyTourCompleted } = await import("./tour-notify.server");
    const res = await notifyTourCompleted(data);
    return {
      ok: res.ok,
      error: res.error ?? "",
      recipients: res.recipients,
      photoCount: res.photoCount,
    };
  });