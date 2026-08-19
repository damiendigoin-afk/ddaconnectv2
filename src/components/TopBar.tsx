import { Link, useRouterState } from "@tanstack/react-router";
import { Home } from "lucide-react";

/** Barre haute persistante : accès direct à l'accueil depuis n'importe quel écran. */
export function TopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hidden = pathname === "/" || pathname.startsWith("/auth");
  if (hidden) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-50 h-10 border-b border-border bg-brand text-brand-foreground">
      <div className="mx-auto flex h-10 max-w-4xl items-center gap-2 px-3">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-extrabold uppercase tracking-wide active:scale-95"
          aria-label="Retour à l'accueil DDA Connect"
        >
          <Home className="h-4 w-4" /> Accueil
        </Link>
        <span className="flex-1 truncate text-right text-xs font-bold uppercase tracking-wide opacity-80">
          DDA Connect
        </span>
      </div>
    </div>
  );
}