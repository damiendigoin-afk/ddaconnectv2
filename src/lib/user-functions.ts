import { supabase } from "@/integrations/supabase/client";

/**
 * Fonctions exercées par un salarié, cumulables. Un droit ne dépend JAMAIS d'un
 * nom ou d'une adresse e-mail : uniquement de ces fonctions et des accès modules.
 */
export const USER_FUNCTIONS = [
  { key: "comptabilite", label: "Comptabilité" },
  { key: "valider_notes_frais", label: "Validation notes de frais" },
  { key: "vente", label: "Vente" },
  { key: "atelier", label: "Atelier" },
  { key: "magasin_achats", label: "Magasin / achats" },
  { key: "administration", label: "Administration" },
  { key: "statistiques", label: "Statistiques" },
  { key: "communication", label: "Communication / marketing" },
  { key: "rh", label: "RH / temps de présence" },
] as const;

export type UserFunctionKey = (typeof USER_FUNCTIONS)[number]["key"];

export async function fetchUserFunctions(userId: string): Promise<Set<string>> {
  const { data } = await supabase.from("user_functions").select("function_key").eq("user_id", userId);
  return new Set(((data ?? []) as { function_key: string }[]).map((r) => r.function_key));
}

export async function fetchAllUserFunctions(): Promise<Map<string, Set<string>>> {
  const { data } = await supabase.from("user_functions").select("user_id, function_key");
  const map = new Map<string, Set<string>>();
  for (const r of (data ?? []) as { user_id: string; function_key: string }[]) {
    const set = map.get(r.user_id) ?? new Set<string>();
    set.add(r.function_key);
    map.set(r.user_id, set);
  }
  return map;
}

export async function setUserFunction(userId: string, key: string, on: boolean) {
  if (on) {
    const { error } = await supabase
      .from("user_functions")
      .upsert({ user_id: userId, function_key: key }, { onConflict: "user_id,function_key" });
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("user_functions").delete().eq("user_id", userId).eq("function_key", key);
  if (error) throw error;
}

/** Sites autorisés en plus du site par défaut (périmètre de consultation). */
export async function fetchUserSites(userId: string): Promise<Set<string>> {
  const { data } = await supabase.from("user_sites").select("site_id").eq("user_id", userId);
  return new Set(((data ?? []) as { site_id: string }[]).map((r) => r.site_id));
}

export async function fetchAllUserSites(): Promise<Map<string, Set<string>>> {
  const { data } = await supabase.from("user_sites").select("user_id, site_id");
  const map = new Map<string, Set<string>>();
  for (const r of (data ?? []) as { user_id: string; site_id: string }[]) {
    const set = map.get(r.user_id) ?? new Set<string>();
    set.add(r.site_id);
    map.set(r.user_id, set);
  }
  return map;
}

export async function setUserSite(userId: string, siteId: string, on: boolean) {
  if (on) {
    const { error } = await supabase
      .from("user_sites")
      .upsert({ user_id: userId, site_id: siteId }, { onConflict: "user_id,site_id" });
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("user_sites").delete().eq("user_id", userId).eq("site_id", siteId);
  if (error) throw error;
}
