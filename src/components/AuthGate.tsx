import { Link, useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { useAuth } from "@/lib/auth";

/** Routes accessibles sans compte DDA Connect (lien client partagé, connexion). */
const PUBLIC_PREFIXES = ["/partage", "/auth", "/api"];

export function AuthGate({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { loading, user, profile, isActive, signOut } = useAuth();

  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-extrabold tracking-tight">
            DDA <span className="text-brand">Connect</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Connexion requise pour continuer.</p>
          <Link
            to="/auth"
            className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-brand px-4 py-4 text-sm font-bold uppercase text-brand-foreground"
          >
            Se connecter
          </Link>
        </div>
      </div>
    );
  }

  if (!isActive) {
    const disabled = profile?.status === "disabled";
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-extrabold tracking-tight">
            DDA <span className="text-brand">Connect</span>
          </h1>
          <div className="card-surface space-y-2 p-5 text-sm">
            <p className="text-base font-bold uppercase">
              {disabled ? "Compte désactivé" : "En attente de validation"}
            </p>
            <p className="text-muted-foreground">
              {disabled
                ? "Votre accès a été désactivé. Contactez un manager."
                : "Votre compte DDA Connect a été créé. Un manager doit maintenant autoriser votre accès."}
            </p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
          <button
            onClick={() => void signOut()}
            className="w-full rounded-xl border-2 border-border bg-card px-4 py-3 text-sm font-bold uppercase"
          >
            Se déconnecter
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
