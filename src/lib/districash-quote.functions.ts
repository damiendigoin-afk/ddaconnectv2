/** Consultation Districash lecture seule pour le devis pneus (à la demande, une connexion par chiffrage). */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({
  siteId: z.string().uuid(),
  width: z.string().regex(/^\d{3}$/),
  height: z.string().regex(/^\d{2}$/),
  diameter: z.string().regex(/^\d{2}$/),
  load: z.string().max(7).nullable().optional(),
  speed: z.string().max(2).nullable().optional(),
  quantity: z.number().int().min(1).max(8),
});

export const fetchDistricashQuoteRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data }) => {
    const { districashSearchForSite } = await import("./districash-search.server");
    return districashSearchForSite(data.siteId, data, data.quantity);
  });
