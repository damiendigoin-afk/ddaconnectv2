import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const plateSchema = z
  .string()
  .min(4)
  .max(12)
  .transform((s) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase());

const credsSchema = z.object({
  username: z.string().min(1).max(120),
  password: z.string().min(1).max(200),
});

const testSchema = z.object({
  username: z.string().max(120).optional(),
  password: z.string().max(200).optional(),
  plate: plateSchema,
});

const vehicleSchema = z.object({
  plate: plateSchema,
  vehicle: z.record(z.string(), z.string()).default({}),
});

async function assertManager(context: { supabase: { rpc: Function }; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "manager",
  });
  if (!data) throw new Error("Accès réservé aux managers.");
}

/** Statut de configuration IXELLIO (jamais d'identifiant renvoyé). */
export const getIxellioSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertManager(context as never);
    const { getIxellioStatus } = await import("./ixellio-store.server");
    return getIxellioStatus();
  });

/** Enregistre (chiffré AES-256-GCM) les identifiants IXELLIO. */
export const saveIxellioSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => credsSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertManager(context as never);
    const { saveIxellioCredentials, getIxellioStatus } = await import("./ixellio-store.server");
    await saveIxellioCredentials(data.username, data.password, context.userId);
    return getIxellioStatus();
  });

/** Supprime les identifiants stockés. */
export const deleteIxellioSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertManager(context as never);
    const { clearIxellioCredentials } = await import("./ixellio-store.server");
    await clearIxellioCredentials();
    return { configured: false, updatedAt: null };
  });

/**
 * Test d'authentification IXELLIO (managers uniquement).
 * Utilise les identifiants stockés si aucun n'est saisi.
 */
export const testIxellioAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => testSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertManager(context as never);
    const { runIxellioWithStoredCredentials } = await import("./ixellio-store.server");
    const override =
      data.username && data.password ? { username: data.username, password: data.password } : undefined;
    return runIxellioWithStoredCredentials(data.plate, override);
  });

/** Interrogation IXELLIO pour une plaque absente de la base (tout utilisateur connecté). */
export const lookupIxellioVehicle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ plate: plateSchema }).parse(data))
  .handler(async ({ data }) => {
    const { runIxellioWithStoredCredentials } = await import("./ixellio-store.server");
    const res = await runIxellioWithStoredCredentials(data.plate);
    return {
      ok: res.outcome === "auth_ok_vehicle_found",
      outcome: res.outcome,
      notConfigured: Boolean((res as { notConfigured?: boolean }).notConfigured),
      message: res.message,
      vehicle: res.vehicle as Record<string, string | undefined>,
      // Diagnostic non sensible : noms de champs uniquement.
      detectedFields: (res as { detectedFields?: string[] }).detectedFields ?? [],
      fieldCount: (res as { fieldCount?: number }).fieldCount ?? 0,
      isVersionList: Boolean((res as { isVersionList?: boolean }).isVersionList),
    };
  });

/** Enregistre le véhicule IXELLIO dans le référentiel local, après validation utilisateur. */
export const saveIxellioVehicle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => vehicleSchema.parse(data))
  .handler(async ({ data }) => {
    const { saveVehicleFromIxellio } = await import("./ixellio-vehicle.server");
    return saveVehicleFromIxellio(data.plate, data.vehicle);
  });
