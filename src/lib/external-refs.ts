/**
 * Correspondances externes (DMS WinMotor).
 *
 * Règle absolue : DDA Connect ne fabrique JAMAIS un identifiant WinMotor
 * (compte client, fiche véhicule, numéro d'OR). Ces identifiants sont créés
 * uniquement par WinMotor ; DDA conserve ses propres identifiants internes et
 * mémorise le rapprochement dans `external_refs`.
 *
 * Statuts : `suggested` (rapprochement proposé, décision humaine attendue),
 * `confirmed` (liaison certaine, réutilisée pour les imports suivants),
 * `rejected` (rapprochement écarté, ne doit plus être proposé).
 */
import { supabase } from "@/integrations/supabase/client";

export type ExternalEntity = "customer" | "vehicle" | "ref_vehicle" | "order" | "client";
export type MatchStatus = "suggested" | "confirmed" | "rejected";

export type ExternalRef = {
  id: string;
  system: string;
  entity_type: string;
  entity_id: string;
  external_id: string;
  match_status: string;
  match_score: number | null;
  match_criteria: unknown;
};

const SYSTEM = "winmotor";

/** Critères de rapprochement jugés fiables (le nom seul n'en fait jamais partie). */
export const RELIABLE_CRITERIA = [
  "winmotor_id",
  "winmotor_or_number",
  "vin",
  "registration",
  "email",
  "phone",
  "siret",
  "name_and_address",
] as const;
export type MatchCriterion = (typeof RELIABLE_CRITERIA)[number] | "name_and_contact";

/** Un rapprochement sur le nom seul n'est jamais suffisant (§5). */
export function isMergeable(criteria: MatchCriterion[]): boolean {
  return criteria.some((c) => c !== "name_and_contact");
}

/** Liaison connue et confirmée pour un identifiant WinMotor donné. */
export async function findConfirmedRef(
  entityType: ExternalEntity,
  externalIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(externalIds.filter(Boolean))];
  if (!ids.length) return out;
  const { data } = await supabase
    .from("external_refs")
    .select("external_id, entity_id")
    .eq("system", SYSTEM)
    .eq("entity_type", entityType)
    .eq("match_status", "confirmed")
    .in("external_id", ids);
  for (const r of data ?? []) out.set(r.external_id, r.entity_id);
  return out;
}

/** Toutes les correspondances (tous statuts) d'une entité DDA. */
export async function listRefs(entityType: ExternalEntity, entityId: string): Promise<ExternalRef[]> {
  const { data } = await supabase
    .from("external_refs")
    .select("id, system, entity_type, entity_id, external_id, match_status, match_score, match_criteria")
    .eq("system", SYSTEM)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false });
  return (data ?? []) as ExternalRef[];
}

/**
 * Enregistre (ou met à jour) un rapprochement. Une liaison déjà confirmée
 * n'est jamais rétrogradée : les imports suivants réutilisent la liaison (§6).
 */
export async function upsertRef(input: {
  entityType: ExternalEntity;
  entityId: string;
  externalId: string;
  status: MatchStatus;
  criteria: MatchCriterion[];
  score?: number | null;
  importId?: string | null;
}): Promise<void> {
  const externalId = input.externalId.trim();
  if (!externalId) return;

  const { data: existing } = await supabase
    .from("external_refs")
    .select("id, match_status")
    .eq("system", SYSTEM)
    .eq("entity_type", input.entityType)
    .eq("entity_id", input.entityId)
    .eq("external_id", externalId)
    .maybeSingle();

  if (existing) {
    if (existing.match_status === "confirmed" || existing.match_status === input.status) return;
    if (existing.match_status === "rejected" && input.status !== "confirmed") return;
    await supabase
      .from("external_refs")
      .update({
        match_status: input.status,
        match_criteria: input.criteria,
        match_score: input.score ?? null,
        confirmed_at: input.status === "confirmed" ? new Date().toISOString() : null,
      })
      .eq("id", existing.id);
    return;
  }

  await supabase.from("external_refs").insert({
    system: SYSTEM,
    entity_type: input.entityType,
    entity_id: input.entityId,
    external_id: externalId,
    match_status: input.status,
    match_criteria: input.criteria,
    match_score: input.score ?? null,
    import_id: input.importId ?? null,
    confirmed_at: input.status === "confirmed" ? new Date().toISOString() : null,
  });
}

/** Décision humaine sur un rapprochement suggéré. */
export async function decideRef(refId: string, status: "confirmed" | "rejected", userId?: string | null) {
  const { error } = await supabase
    .from("external_refs")
    .update({
      match_status: status,
      confirmed_by: status === "confirmed" ? (userId ?? null) : null,
      confirmed_at: status === "confirmed" ? new Date().toISOString() : null,
    })
    .eq("id", refId);
  if (error) throw error;
}
