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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptSecret } = await import("./crypto.server");
    const { districashLoginAndSearch, summarizeDistricashTest } = await import("./districash-session.server");
    const { districashProvider } = await import("./districash");
    const { data: c } = await supabaseAdmin
      .from("integration_credentials")
      .select("username_enc, password_enc")
      .eq("provider", districashProvider(data.siteId))
      .maybeSingle();
    if (!c?.username_enc || !c?.password_enc)
      return { ok: false as const, error: "Districash : aucun identifiant enregistré pour ce site.", rows: [], consultedAt: "" };
    try {
      const r = await districashLoginAndSearch(
        decryptSecret(c.username_enc),
        decryptSecret(c.password_enc),
        { width: data.width, height: data.height, diameter: data.diameter, load: data.load ?? "", speed: data.speed ?? "" },
        data.quantity,
      );
      const s = summarizeDistricashTest(r);
      if (!r.authenticated) return { ok: false as const, error: `Districash : ${s.message}`, rows: [], consultedAt: "" };
      // Lignes brutes renvoyées au moteur ; le filtrage J/J+ est fait côté moteur (quotableDistricashRows).
      return { ok: true as const, error: "", rows: r.rows, consultedAt: new Date().toISOString() };
    } catch {
      return { ok: false as const, error: "Districash injoignable depuis le serveur.", rows: [], consultedAt: "" };
    }
  });
