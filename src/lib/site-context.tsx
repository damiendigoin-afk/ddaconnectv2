import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchSites, guessSiteCode, GROUP_LABEL, type Site } from "@/lib/sites";
import { isValidSiteValue } from "@/lib/client-recovery";
import { useAuth } from "@/lib/auth";
import { fetchUserSites } from "@/lib/user-functions";

type SiteState = {
  sites: Site[];
  /** Site actif (null en mode Groupe). */
  site: Site | null;
  /** Contexte actif : identifiant de site ou "groupe". */
  active: string;
  isGroup: boolean;
  label: string;
  /** Changement ponctuel — ne modifie pas le site par défaut du profil. */
  setActive: (v: string) => void;
};

const Ctx = createContext<SiteState | null>(null);
const KEY = "dda.active-site";

export function SiteProvider({ children }: { children: ReactNode }) {
  const { profile, user, isManager } = useAuth();
  const sites = useQuery({ queryKey: ["sites"], queryFn: fetchSites, staleTime: 5 * 60_000 });
  const authorized = useQuery({
    queryKey: ["user-sites", user?.id],
    queryFn: () => fetchUserSites(user?.id ?? ""),
    enabled: !!user?.id && !isManager,
    staleTime: 5 * 60_000,
  });
  const [active, setActiveState] = useState<string>("");

  const list = useMemo(() => {
    const all = sites.data ?? [];
    if (isManager || profile?.site_scope === "groupe") return all;
    const allowed = new Set(authorized.data ?? []);
    if (profile?.site_id) allowed.add(profile.site_id);
    return all.filter((candidate) => allowed.has(candidate.id));
  }, [sites.data, isManager, profile?.site_id, profile?.site_scope, authorized.data]);

  useEffect(() => {
    if (active) return;
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    // Un site mémorisé supprimé/illisible (ancien cache mobile) ne doit jamais
    // laisser l'application dans un contexte fantôme : on l'ignore et on purge.
    const usable =
      isValidSiteValue(stored) && (stored === "groupe" || !list.length || list.some((s) => s.id === stored));
    if (stored && !usable && typeof window !== "undefined" && list.length) {
      window.localStorage.removeItem(KEY);
    }
    if (stored && usable) {
      setActiveState(stored);
      return;
    }
    if (profile?.site_scope === "groupe") {
      setActiveState("groupe");
      return;
    }
    if (profile?.site_id) {
      setActiveState(profile.site_id);
      return;
    }
    const guessed = guessSiteCode(profile?.email);
    const match = guessed ? list.find((s) => s.code === guessed) : null;
    if (match) setActiveState(match.id);
    else if (list.length) setActiveState(list[0]!.id);
  }, [active, profile, list]);

  useEffect(() => {
    if (!active || !list.length || active === "groupe") return;
    if (!list.some((candidate) => candidate.id === active)) {
      const fallback = profile?.site_id && list.some((candidate) => candidate.id === profile.site_id)
        ? profile.site_id
        : list[0]?.id ?? "";
      setActiveState(fallback);
      if (typeof window !== "undefined") window.localStorage.setItem(KEY, fallback);
    }
  }, [active, list, profile?.site_id]);

  const setActive = useCallback((v: string) => {
    if (v !== "groupe" && !list.some((candidate) => candidate.id === v)) return;
    if (v === "groupe" && !isManager && profile?.site_scope !== "groupe") return;
    setActiveState(v);
    if (typeof window !== "undefined") window.localStorage.setItem(KEY, v);
  }, [isManager, list, profile?.site_scope]);

  const isGroup = active === "groupe";
  const site = isGroup ? null : (list.find((s) => s.id === active) ?? null);

  const value = useMemo<SiteState>(
    () => ({
      sites: list,
      site,
      active,
      isGroup,
      label: isGroup ? GROUP_LABEL : (site?.name ?? "—"),
      setActive,
    }),
    [list, site, active, isGroup, setActive],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSite(): SiteState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSite must be used inside <SiteProvider>");
  return ctx;
}
