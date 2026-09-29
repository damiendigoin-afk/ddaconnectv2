import { supabase } from "@/integrations/supabase/client";
import type { EnsureResult } from "./or-scan-decision";

/**
 * Ouvre ou crée la fiche dossier DDA locale d'un OR WinMotor (clé site + n° d'OR).
 * Atomique côté base : un second scan du même OR rouvre la même fiche.
 */
export async function ensureWinmotorDossier(input: {
  siteId: string | null;
  orNumber: string;
  plate?: string | null;
  userName?: string | null;
}): Promise<EnsureResult> {
  if (!input.siteId) return { error: "site_required" };
  const { data, error } = await supabase.rpc("ensure_winmotor_dossier", {
    _site: input.siteId,
    _or_number: input.orNumber.trim(),
    _plate: input.plate ?? undefined,
    _user_name: input.userName ?? undefined,
  });
  if (error) {
    console.error(error);
    return { error: error.message };
  }
  return (data ?? {}) as EnsureResult;
}
