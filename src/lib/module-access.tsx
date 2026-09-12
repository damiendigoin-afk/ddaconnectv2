import { useQuery } from "@tanstack/react-query";

import { fetchModuleAccess, MODULES, type ModuleKey } from "@/lib/access";
import { useAuth } from "@/lib/auth";
import { fetchUserFunctions } from "@/lib/user-functions";

/**
 * Association préfixe d'URL -> module, construite directement depuis le
 * registre central des modules. Les préfixes les plus précis sont testés en
 * premier (/devis/pneus avant /devis).
 */
export const MODULE_ROUTES: { prefix: string; module: ModuleKey }[] = MODULES.flatMap((m) =>
  (("prefixes" in m ? (m.prefixes as readonly string[]) : []) ?? []).map((prefix) => ({
    prefix,
    module: m.key as ModuleKey,
  })),
).sort((a, b) => b.prefix.length - a.prefix.length);

export function moduleForPath(pathname: string): ModuleKey | null {
  const hit = MODULE_ROUTES.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
  return hit?.module ?? null;
}

/** Droits modules de l'utilisateur courant. Les managers ont tout. */
export function useModuleAccess() {
  const { user, isManager, loading } = useAuth();
  const uid = user?.id ?? "";
  const q = useQuery({
    queryKey: ["module-access", uid],
    queryFn: () => fetchModuleAccess(uid),
    enabled: !!uid && !isManager,
    staleTime: 60_000,
  });

  const ready = !loading && (isManager || !uid || !q.isLoading);
  const can = (key: ModuleKey | null | undefined) => {
    if (!key) return true;
    if (isManager) return true;
    return q.data?.has(key) ?? false;
  };
  return { ready, can, isManager };
}

/**
 * Droits fins : fonctions exercées (Comptabilité, Validation…) cumulées aux
 * accès modules explicites. Aucun droit n'est déduit d'un nom ou d'un e-mail.
 */
export function usePermissions() {
  const { user, isManager, loading } = useAuth();
  const uid = user?.id ?? "";

  const modules = useQuery({
    queryKey: ["module-access", uid],
    queryFn: () => fetchModuleAccess(uid),
    enabled: !!uid,
    staleTime: 60_000,
  });
  const functions = useQuery({
    queryKey: ["user-functions", uid],
    queryFn: () => fetchUserFunctions(uid),
    enabled: !!uid,
    staleTime: 60_000,
  });

  const hasModule = (key: string) => modules.data?.has(key) ?? false;
  const hasFunction = (key: string) => functions.data?.has(key) ?? false;

  return {
    ready: !loading && !!uid && !modules.isLoading && !functions.isLoading,
    isManager,
    hasModule,
    hasFunction,
    /** Saisie d'une note : ouverte à tout utilisateur ayant le module. */
    canCreateExpense: isManager || hasModule("notes_frais") || hasModule("notes_frais_creer"),
    canValidateExpenses: isManager || hasFunction("valider_notes_frais") || hasModule("notes_frais_valider"),
    canAccountExpenses: isManager || hasFunction("comptabilite") || hasModule("notes_frais_compta"),
  };
}
