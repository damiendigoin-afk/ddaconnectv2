import { useQuery } from "@tanstack/react-query";

import { fetchModuleAccess, type ModuleKey } from "@/lib/access";
import { useAuth } from "@/lib/auth";

/** Association préfixe d'URL -> module soumis aux droits utilisateur. */
export const MODULE_ROUTES: { prefix: string; module: ModuleKey }[] = [
  { prefix: "/tour-vehicule", module: "tour" },
  { prefix: "/tours", module: "tour" },
  { prefix: "/tour", module: "tour" },
  { prefix: "/ordres", module: "tour" },
  { prefix: "/or", module: "tour" },
  { prefix: "/expertises", module: "expertise" },
  { prefix: "/expertise", module: "expertise" },
  { prefix: "/carrosserie", module: "carrosserie" },
  { prefix: "/magasin", module: "magasin" },
  { prefix: "/base", module: "base" },
  { prefix: "/qualite", module: "qualite" },
  { prefix: "/emails", module: "emails" },
  { prefix: "/crm", module: "crm" },
  { prefix: "/darva", module: "darva" },
  { prefix: "/maintenance", module: "maintenance" },
  { prefix: "/connaissances", module: "connaissances" },
  { prefix: "/recuperation", module: "recuperation" },
  { prefix: "/notes-frais", module: "notes_frais" },
  { prefix: "/pilotage", module: "pilotage" },
  { prefix: "/automatisations", module: "automatisations" },
];

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
