import { supabase } from "@/integrations/supabase/client";

/** Droits attribuables par utilisateur en plus du rôle. */
export const MODULES = [
  { key: "tour", label: "Tour Véhicule" },
  { key: "expertise", label: "Expertise Véhicule" },
  { key: "carrosserie", label: "Carrosserie" },
  { key: "magasin", label: "Magasin" },
  { key: "base", label: "Base de données" },
  { key: "qualite", label: "Qualité des données" },
  { key: "emails", label: "Flux emails" },
  { key: "crm", label: "CRM" },
  { key: "darva", label: "Gestion DARVA" },
  { key: "maintenance", label: "Maintenance prédictive" },
  { key: "connaissances", label: "Base de connaissances" },
  { key: "recuperation", label: "Ventes" },
  { key: "notes_frais", label: "Notes de frais" },
  { key: "pilotage", label: "Gestion" },
  { key: "automatisations", label: "Automatisations" },
  { key: "stats_equipe", label: "Statistiques équipe" },
  { key: "stats_import", label: "Import statistiques" },
] as const;

export type ModuleKey = (typeof MODULES)[number]["key"];

export async function fetchModuleAccess(userId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from("user_module_access")
    .select("module_key, allowed")
    .eq("user_id", userId);
  return new Set(((data ?? []) as { module_key: string; allowed: boolean }[]).filter((m) => m.allowed).map((m) => m.module_key));
}

export async function fetchAllModuleAccess(): Promise<Map<string, Set<string>>> {
  const { data } = await supabase.from("user_module_access").select("user_id, module_key, allowed");
  const map = new Map<string, Set<string>>();
  for (const r of (data ?? []) as { user_id: string; module_key: string; allowed: boolean }[]) {
    if (!r.allowed) continue;
    const set = map.get(r.user_id) ?? new Set<string>();
    set.add(r.module_key);
    map.set(r.user_id, set);
  }
  return map;
}

export async function setModuleAccess(userId: string, moduleKey: string, allowed: boolean) {
  const { error } = await supabase
    .from("user_module_access")
    .upsert({ user_id: userId, module_key: moduleKey, allowed }, { onConflict: "user_id,module_key" });
  if (error) throw error;
}
