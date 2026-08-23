/**
 * Intervention DDA et référence externe d'OR WinMotor.
 *
 * DDA Connect ne crée JAMAIS d'OR : un OR (ordre de réparation) est un objet
 * officiel produit uniquement par WinMotor, puis importé/scanné/identifié dans
 * DDA. Ce que DDA crée est une INTERVENTION (contexte de travail sur un
 * véhicule), identifiée par une référence interne DDA. Le rattachement à un OR
 * WinMotor est optionnel et peut intervenir plus tard.
 */
import { supabase } from "@/integrations/supabase/client";
import { findDuplicateOrder } from "./queries";
import { upsertRef } from "./external-refs";

export type OrIdentity = {
  or_number?: string | null;
  internal_ref?: string | null;
  or_status?: string | null;
  record_type?: string | null;
};

/** Génère la prochaine référence interne DDA d'intervention (ex. DDA-2026-00042). */
export async function nextInternalRef(): Promise<string | null> {
  const { data, error } = await supabase.rpc("next_dda_order_ref");
  if (error) {
    console.error(error);
    return null;
  }
  return (data as string | null) ?? null;
}

/** Vrai si un véritable numéro d'OR WinMotor est rattaché. */
export function hasWinmotorOr(o: OrIdentity | null | undefined): boolean {
  return Boolean(o?.or_number && o.or_number.trim());
}

/** Libellé principal : « Intervention <réf. DDA> », l'OR WinMotor restant une référence externe. */
export function interventionLabel(o: OrIdentity | null | undefined): string {
  if (o?.internal_ref) return `Intervention ${o.internal_ref}`;
  if (hasWinmotorOr(o)) return `Intervention · OR WinMotor ${o?.or_number}`;
  return "Intervention sans référence";
}

/** Référence externe affichable, uniquement si un OR WinMotor existe réellement. */
export function winmotorOrLabel(o: OrIdentity | null | undefined): string | null {
  return hasWinmotorOr(o) ? `OR WinMotor ${o?.or_number}` : null;
}

/** @deprecated conservé pour compatibilité : utilise `interventionLabel`. */
export const orLabel = interventionLabel;

/** Vrai tant qu'aucun OR WinMotor n'est rattaché à l'intervention. */
export function isOrPending(o: OrIdentity | null | undefined): boolean {
  return !hasWinmotorOr(o);
}

export const OR_PENDING_LABEL = "Aucun OR WinMotor rattaché";
export const INTERVENTION_LABEL = "Intervention";

/**
 * Rattache un numéro d'OR WinMotor existant à une intervention DDA.
 * Recherche d'abord une intervention portant déjà ce numéro : aucune fusion
 * automatique, la décision reste humaine en cas de doute.
 */
export async function attachOrNumber(input: {
  orderId: string;
  orNumber: string;
  plate: string;
  source?: string;
}): Promise<{ ok: boolean; conflict?: { id: string; plate: string }[]; error?: string }> {
  const num = input.orNumber.trim();
  if (!num) return { ok: false, error: "Numéro d'OR WinMotor vide" };

  const dup = await findDuplicateOrder(num, input.plate);
  const others = [
    ...(dup.exact && dup.exact.id !== input.orderId ? [{ id: dup.exact.id, plate: input.plate }] : []),
    ...dup.sameNumber.filter((o) => o.id !== input.orderId),
  ];
  if (others.length) return { ok: false, conflict: others };

  const { error } = await supabase
    .from("repair_orders")
    .update({
      or_number: num,
      or_status: "or_complet",
      record_type: "or_winmotor",
      or_source: input.source ?? "saisie_manuelle",
      or_linked_at: new Date().toISOString(),
    })
    .eq("id", input.orderId);
  if (error) return { ok: false, error: error.message };

  try {
    await upsertRef({
      entityType: "order",
      entityId: input.orderId,
      externalId: num,
      status: "confirmed",
      criteria: ["winmotor_or_number"],
    });
  } catch (e) {
    console.error(e);
  }
  return { ok: true };
}
