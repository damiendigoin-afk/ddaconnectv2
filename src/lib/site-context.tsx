import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchSites, guessSiteCode, GROUP_LABEL, type Site } from "@/lib/sites";
import { isValidSiteValue } from "@/lib/client-recovery";
import { useAuth } from "@/lib/auth";

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
  const { profile } = useAuth();
  const sites = useQuery({ queryKey: ["sites"], queryFn: fetchSites, staleTime: 5 * 60_000 });
  const [active, setActiveState] = useState<string>("");

  const list = useMemo(() => sites.data ?? [], [sites.data]);

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

  const setActive = useCallback((v: string) => {
    setActiveState(v);
    if (typeof window !== "undefined") window.localStorage.setItem(KEY, v);
  }, []);

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
