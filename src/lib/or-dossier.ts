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
  const args: { _site: string; _or_number: string; _plate?: string; _user_name?: string } = {
    _site: input.siteId,
    _or_number: input.orNumber.trim(),
  };
  if (input.plate) args._plate = input.plate;
  if (input.userName) args._user_name = input.userName;
  const { data, error } = await supabase.rpc("ensure_winmotor_dossier", args);
  if (error) {
    console.error(error);
    return { error: error.message };
  }
  return (data ?? {}) as EnsureResult;
}
