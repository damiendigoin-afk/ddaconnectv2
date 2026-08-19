import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

export type AppRole = "manager" | "salarie" | "client";
export type UserStatus = "pending" | "active" | "disabled";

export type Profile = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  status: UserStatus;
  site_id: string | null;
  site_scope: string;
  gmail_allowed: boolean;
  created_at: string;
};

type AuthState = {
  loading: boolean;
  user: User | null;
  profile: Profile | null;
  role: AppRole | null;
  isManager: boolean;
  isActive: boolean;
  displayName: string;
  refresh: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function displayNameOf(p: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
} | null): string {
  if (!p) return "";
  const n = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return n || p.email || "";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);

  const load = useCallback(async (uid: string | null) => {
    if (!uid) {
      setProfile(null);
      setRole(null);
      return;
    }
    const [{ data: p }, { data: r }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
    ]);
    setProfile((p as Profile) ?? null);
    const roles = ((r ?? []) as { role: AppRole }[]).map((x) => x.role);
    setRole(roles.includes("manager") ? "manager" : (roles[0] ?? null));
  }, []);

  useEffect(() => {
    let alive = true;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return;
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED" && event !== "INITIAL_SESSION")
        return;
      const u = session?.user ?? null;
      setUser(u);
      void load(u?.id ?? null).finally(() => setLoading(false));
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      const u = data.session?.user ?? null;
      setUser(u);
      void load(u?.id ?? null).finally(() => setLoading(false));
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [load]);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      user,
      profile,
      role,
      isManager: role === "manager",
      isActive: profile?.status === "active",
      displayName: displayNameOf(profile) || user?.email || "",
      refresh: () => load(user?.id ?? null),
      signInWithGoogle: async () => {
        await lovable.auth.signInWithOAuth("google", {
          redirect_uri: window.location.origin,
        });
      },
      signOut: async () => {
        await supabase.auth.signOut();
        setUser(null);
        setProfile(null);
        setRole(null);
      },
    }),
    [loading, user, profile, role, load],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
