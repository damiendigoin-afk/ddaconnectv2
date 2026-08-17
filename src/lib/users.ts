import { supabase } from "@/integrations/supabase/client";
import type { AppRole, Profile, UserStatus } from "./auth";

export type ManagedUser = Profile & { role: AppRole | null };

export async function fetchUsers(): Promise<ManagedUser[]> {
  const [{ data: profiles, error }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at", { ascending: false }),
    supabase.from("user_roles").select("user_id, role"),
  ]);
  if (error) throw error;
  const byUser = new Map<string, AppRole>();
  for (const r of (roles ?? []) as { user_id: string; role: AppRole }[]) {
    if (r.role === "manager" || !byUser.has(r.user_id)) byUser.set(r.user_id, r.role);
  }
  return ((profiles ?? []) as Profile[]).map((p) => ({ ...p, role: byUser.get(p.id) ?? null }));
}

export async function setUserStatus(userId: string, status: UserStatus) {
  const { error } = await supabase.from("profiles").update({ status }).eq("id", userId);
  if (error) throw error;
}

export async function setUserRole(userId: string, role: AppRole) {
  const del = await supabase.from("user_roles").delete().eq("user_id", userId);
  if (del.error) throw del.error;
  const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
  if (error) throw error;
}

export const STATUS_LABELS: Record<UserStatus, string> = {
  pending: "En attente",
  active: "Actif",
  disabled: "Désactivé",
};

export const ROLE_LABELS: Record<AppRole, string> = {
  manager: "Manager",
  salarie: "Salarié",
  client: "Client",
};

export async function setUserNames(userId: string, firstName: string, lastName: string) {
  const { error } = await supabase
    .from("profiles")
    .update({ first_name: firstName.trim() || null, last_name: lastName.trim() || null })
    .eq("id", userId);
  if (error) throw error;
}
