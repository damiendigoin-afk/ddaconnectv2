import { supabase } from "@/integrations/supabase/client";

export type AuditEntity = "client" | "vehicle" | "repair_order" | "inspection" | "inspection_point" | "observation";

/**
 * Conserve valeur précédente / nouvelle valeur / date / auteur pour chaque champ
 * corrigé dans DDA Connect (base des futures propositions de mise à jour DMS).
 */
export async function logChanges(args: {
  entity: AuditEntity;
  entityId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  userId?: string | null;
  userName?: string | null;
}) {
  const rows = Object.keys(args.after)
    .filter((k) => String(args.before[k] ?? "") !== String(args.after[k] ?? ""))
    .map((k) => ({
      entity_type: args.entity,
      entity_id: args.entityId,
      field: k,
      old_value: args.before[k] == null ? null : String(args.before[k]),
      new_value: args.after[k] == null ? null : String(args.after[k]),
      changed_by: args.userId ?? null,
      changed_by_name: args.userName ?? null,
    }));
  if (!rows.length) return 0;
  const { error } = await supabase.from("field_changes").insert(rows);
  if (error) console.error(error);
  return rows.length;
}
