import { supabase } from "@/integrations/supabase/client";
import { stripGarageContacts, type SiteLike } from "./garage-identity";
import type { DossierConflict, DossierData, EnsureResult } from "./or-scan-decision";

export type EnsureFullResult = EnsureResult & { conflicts?: DossierConflict[] };

/**
 * Ouvre ou constitue la fiche dossier DDA d'un OR WinMotor (clé site + n° d'OR) à partir
 * de la lecture de l'OR papier : véhicule (plaque, VIN, historique WinMotor) et client
 * (lié, e-mail, téléphone) réutilisés ; champs vides complétés ; conflits renvoyés, jamais écrasés.
 */
export async function ensureWinmotorDossier(input: {
  siteId: string | null;
  orNumber: string;
  plate?: string | null;
  data?: DossierData | null;
  userName?: string | null;
  site?: SiteLike;
}): Promise<EnsureFullResult> {
  if (!input.siteId) return { error: "site_required" };
  const raw: DossierData = input.data ?? { client: {}, vehicle: {}, order: {} };
  // Coordonnées du garage lues dans l'en-tête de l'OR : jamais des données client.
  const data: DossierData = { ...raw, client: stripGarageContacts(raw.client ?? {}, input.site) };
  if (input.plate && !data.vehicle["plate"]) data.vehicle = { ...data.vehicle, plate: input.plate };
  const args: { _site: string; _or_number: string; _data: DossierData; _user_name?: string } = {
    _site: input.siteId,
    _or_number: input.orNumber.trim(),
    _data: data,
  };
  if (input.userName) args._user_name = input.userName;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: res, error } = await supabase.rpc("ensure_winmotor_dossier_full", args as any);
  if (error) {
    console.error(error);
    return { error: error.message };
  }
  return (res ?? {}) as EnsureFullResult;
}

/** Applique une valeur lue après confirmation explicite de l'utilisateur. */
export async function applyDossierConflict(c: DossierConflict): Promise<boolean> {
  const { error } = await supabase.rpc("apply_dossier_conflict", { _entity: c.entity, _id: c.id, _field: c.field, _value: c.read ?? "" });
  if (error) console.error(error);
  return !error;
}
