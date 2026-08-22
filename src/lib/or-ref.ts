/**
 * Référence interne DDA et complétion du numéro d'OR WinMotor (cahier des charges V0.2, §33).
 *
 * Le numéro d'OR officiel est généré par WinMotor et peut ne pas exister à l'accueil :
 * il n'est jamais obligatoire. Un identifiant interne DDA unique est créé à la place,
 * et n'est jamais présenté comme un numéro d'OR officiel.
 */
import { supabase } from "@/integrations/supabase/client";
import { findDuplicateOrder } from "./queries";

export type OrIdentity = {
  or_number?: string | null;
  internal_ref?: string | null;
  or_status?: string | null;
};

/** Génère la prochaine référence interne DDA (ex. DDA-2026-00042). */
export async function nextInternalRef(): Promise<string | null> {
  const { data, error } = await supabase.rpc("next_dda_order_ref");
  if (error) {
    console.error(error);
    return null;
  }
  return (data as string | null) ?? null;
}

/** Libellé d'affichage : n° OR officiel s'il existe, sinon référence interne DDA. */
export function orLabel(o: OrIdentity | null | undefined): string {
  if (o?.or_number && o.or_number.trim()) return `OR ${o.or_number}`;
  if (o?.internal_ref) return `Réf. ${o.internal_ref}`;
  return "Dossier sans référence";
}

/** Vrai tant que le numéro d'OR WinMotor n'a pas été renseigné. */
export function isOrPending(o: OrIdentity | null | undefined): boolean {
  return !(o?.or_number && o.or_number.trim());
}

export const OR_PENDING_LABEL = "En attente du numéro d'OR WinMotor";

/**
 * Rattache le numéro d'OR WinMotor à un dossier existant.
 * Recherche d'abord un dossier portant déjà ce numéro (§28) : aucune fusion automatique,
 * la décision reste humaine en cas de doute.
 */
export async function attachOrNumber(input: {
  orderId: string;
  orNumber: string;
  plate: string;
}): Promise<{ ok: boolean; conflict?: { id: string; plate: string }[]; error?: string }> {
  const num = input.orNumber.trim();
  if (!num) return { ok: false, error: "Numéro d'OR vide" };

  const dup = await findDuplicateOrder(num, input.plate);
  const others = [
    ...(dup.exact && dup.exact.id !== input.orderId ? [{ id: dup.exact.id, plate: input.plate }] : []),
    ...dup.sameNumber.filter((o) => o.id !== input.orderId),
  ];
  if (others.length) return { ok: false, conflict: others };

  const { error } = await supabase
    .from("repair_orders")
    .update({ or_number: num, or_status: "or_complet" })
    .eq("id", input.orderId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
