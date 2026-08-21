import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({
  username: z.string().min(1).max(120),
  password: z.string().min(1).max(200),
  plate: z
    .string()
    .min(4)
    .max(12)
    .transform((s) => s.replace(/\s|-/g, "").toUpperCase()),
});

/**
 * Test d'authentification IXELLIO (managers uniquement).
 * Les identifiants transitent uniquement en mémoire : aucun stockage, aucun log.
 */
export const testIxellioAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }) => {
    const { data: isManager } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "manager",
    });
    if (!isManager) {
      return {
        outcome: "unexpected_response" as const,
        authenticated: false,
        loginStatus: null,
        searchStatus: null,
        loginRedirect: null,
        searchRedirect: null,
        trace: [] as string[],
        durationMs: 0,
        bytes: 0,
        vehicle: {},
        message: "Accès réservé aux managers.",
      };
    }


    const { runIxellioAuthTest } = await import("./ixellio.server");
    return runIxellioAuthTest(data);
  });
