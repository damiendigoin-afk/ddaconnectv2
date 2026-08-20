import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { readStoredOdometer } from "./mileage-ocr.server";

export const ocrStoredOdometer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ path: z.string().min(1).max(1000) }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: signed, error } = await context.supabase.storage
      .from("dda-media")
      .createSignedUrl(data.path, 60 * 5);
    if (error || !signed?.signedUrl) {
      return { ok: false as const, error: "Photo inaccessible pour l’analyse.", mileage: 0 };
    }

    return readStoredOdometer(signed.signedUrl);
  });