import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertManager(context: { supabase: { rpc: Function }; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "manager" });
  if (!data) throw new Error("Accès réservé aux administrateurs.");
}

const siteSchema = z.object({ siteId: z.string().uuid() });

/** Statut par site (jamais d'identifiant renvoyé). */
export const getDistricashStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertManager(context as never);
    const { listDistricashStatus } = await import("./districash-store.server");
    return listDistricashStatus();
  });

export const saveDistricashSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    siteSchema.extend({ username: z.string().min(1).max(120), password: z.string().min(1).max(200) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertManager(context as never);
    const { saveDistricashCredentials } = await import("./districash-store.server");
    await saveDistricashCredentials(data.siteId, data.username, data.password, context.userId);
    return { ok: true };
  });

export const deleteDistricashSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => siteSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertManager(context as never);
    const { clearDistricashCredentials } = await import("./districash-store.server");
    await clearDistricashCredentials(data.siteId);
    return { ok: true };
  });

export const testDistricashConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => siteSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertManager(context as never);
    const { testDistricash } = await import("./districash-store.server");
    return testDistricash(data.siteId);
  });
