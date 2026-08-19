/** Modèles de messages administrables (Paramétrage global → Modèles de messages). */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type MessageTemplate = Database["public"]["Tables"]["message_templates"]["Row"];

/** Motifs de communication expert : un seul parcours, plusieurs intentions. */
export const EXPERT_REASONS = [
  { key: "expert_passage", label: "Passage terrain demandé" },
  { key: "expert_complementaires", label: "Travaux complémentaires" },
  { key: "expert_autre", label: "Autre" },
] as const;

export type ExpertReasonKey = (typeof EXPERT_REASONS)[number]["key"];

export async function listTemplates(): Promise<MessageTemplate[]> {
  const { data, error } = await supabase.from("message_templates").select("*").order("label");
  if (error) throw error;
  return (data ?? []) as MessageTemplate[];
}

export async function saveTemplate(id: string, patch: { label?: string; subject?: string; body?: string }) {
  const { error } = await supabase.from("message_templates").update(patch).eq("id", id);
  if (error) throw error;
}

/** Remplace les variables {{plate}}, {{vehicle}}, {{or}}, {{claim}}, {{customer}}. */
export function fillPlaceholders(text: string, vars: Record<string, string | null | undefined>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (vars[k] ?? "—").toString());
}
