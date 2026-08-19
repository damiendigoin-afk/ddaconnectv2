import { Link, useRouterState } from "@tanstack/react-router";
import { Loader2, Lock } from "lucide-react";
import type { ReactNode } from "react";

import { MODULES } from "@/lib/access";
import { moduleForPath, useModuleAccess } from "@/lib/module-access";

/** Bloque l'accès direct aux URLs des modules non autorisés. */
export function ModuleGate({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const moduleKey = moduleForPath(pathname);
  const { ready, can } = useModuleAccess();

  if (!moduleKey) return <>{children}</>;

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (can(moduleKey)) return <>{children}</>;

  const label = MODULES.find((m) => m.key === moduleKey)?.label ?? "Ce module";
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
        <div className="card-surface space-y-2 p-5 text-sm">
          <p className="text-base font-bold uppercase">Accès non autorisé</p>
          <p className="text-muted-foreground">
            Le module « {label} » n'est pas activé sur votre profil. Demandez à un manager de vous l'ouvrir.
          </p>
        </div>
        <Link
          to="/"
          className="inline-flex w-full items-center justify-center rounded-xl bg-brand px-4 py-4 text-sm font-bold uppercase text-brand-foreground"
        >
          Retour à l'accueil
        </Link>
      </div>
    </div>
  );
}
