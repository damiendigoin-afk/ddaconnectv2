import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { askVision, parseJsonBlock } from "./ocr.server";

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

    const prompt = `Lis le kilométrage total affiché sur ce compteur de véhicule (pas le trip / journalier).
Réponds STRICTEMENT en JSON : {"mileage":78452,"unit":"km"}
Si illisible : {"mileage":null,"unit":null}`;
    const result = await askVision(prompt, signed.signedUrl, "compteur.jpg");
    if (!result.ok) return { ok: false as const, error: result.error, mileage: 0 };
    const parsed = parseJsonBlock(result.content);
    const raw = parsed?.["mileage"];
    const mileage = typeof raw === "number" ? Math.round(raw) : 0;
    if (!mileage) return { ok: false as const, error: "Kilométrage non détecté.", mileage: 0 };
    return { ok: true as const, error: "", mileage };
  });