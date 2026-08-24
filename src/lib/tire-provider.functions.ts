/**
 * Consultation serveur des prix publics pneumatiques (CentralePneus).
 * L'état réel du provider est enregistré dans commercial_settings : le drapeau
 * n'est jamais forcé, il reflète la dernière consultation effective.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const input = z.object({ size: z.string().min(3) });

export const fetchPublicTireOffers = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data }) => {
    const { fetchPublicTires } = await import("./tire-provider.server");
    const result = await fetchPublicTires(data.size);

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: row } = await supabaseAdmin
        .from("commercial_settings")
        .select("id")
        .limit(1)
        .maybeSingle();
      if (row?.id) {
        await supabaseAdmin
          .from("commercial_settings")
          .update({
            tire_provider_status: result.ok ? "operationnel" : "indisponible",
            tire_provider_message: result.ok ? null : result.error,
            tire_supplier_configured: result.ok,
            ...(result.ok ? { tire_provider_last_ok_at: result.consultedAt } : {}),
          })
          .eq("id", row.id);
      }
    } catch {
      // L'état du provider est indicatif : une écriture impossible ne bloque pas le chiffrage.
    }

    if (!result.ok) {
      return {
        ok: false as const,
        error: result.error,
        items: [],
        sourceUrl: result.sourceUrl,
        consultedAt: result.consultedAt,
      };
    }
    return {
      ok: true as const,
      error: "",
      items: result.items,
      sourceUrl: result.sourceUrl,
      consultedAt: result.consultedAt,
    };
  });
