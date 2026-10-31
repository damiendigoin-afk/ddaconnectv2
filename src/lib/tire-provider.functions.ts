/**
 * Consultation serveur des prix publics pneumatiques (CentralePneus).
 * L'état réel du provider est enregistré dans commercial_settings : le drapeau
 * n'est jamais forcé, il reflète la dernière consultation effective.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const input = z.object({
  size: z.string().min(3),
  /** Marques nécessaires au chiffrage (gammes paramétrées + marque demandée). */
  brands: z.array(z.string().min(1)).max(24).optional(),
});

export const fetchPublicTireOffers = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data }) => {
    const { fetchPublicTires } = await import("./tire-provider.server");
    const result = await fetchPublicTires(data.size, data.brands ?? []);


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

const allInput = z.object({
  size: z.string().min(3),
  season: z.enum(["ete", "quatre_saisons", "hiver"]),
  load: z.string().max(12).nullable(),
  speed: z.string().max(4).nullable(),
  /** Gammes du paramétrage DDA (marque minuscule → gamme, null si désactivée). */
  configured: z.record(z.string().max(60), z.enum(["entree", "milieu", "haut"]).nullable()),
});

/**
 * Top prix : consultation CentralePneus toutes marques (lecture seule, aucune
 * écriture d'état fournisseur, aucune liste de marques présélectionnée).
 */
export const fetchPublicTireOffersAllBrands = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => allInput.parse(data))
  .handler(async ({ data }) => {
    const { fetchPublicTiresAllBrands } = await import("./tire-provider.server");
    const r = await fetchPublicTiresAllBrands(data);
    if (!r.ok) return { ok: false as const, error: r.error, items: [], truncated: false, pagesRead: 0 };
    return { ok: true as const, error: "", items: r.items, truncated: r.truncated === true, pagesRead: r.pagesRead ?? 0 };
  });
