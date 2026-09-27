import { Link, useRouterState } from "@tanstack/react-router";
import { Home } from "lucide-react";
import type { ReactNode } from "react";

import { useAuth } from "@/lib/auth";
import { useSite } from "@/lib/site-context";
import { GROUP_LABEL } from "@/lib/sites";

/** Décale le contenu sous la barre haute fixe quand elle est affichée. */
export function TopBarSpacer({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hidden = pathname === "/" || pathname.startsWith("/auth");
  return <div className={hidden ? undefined : "pt-10"}>{children}</div>;
}

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
        <span className="flex-1" />
        <ActiveSitePicker />
      </div>
    </div>
  );
}
/**
 * Sélecteur global du site actif (mémorisé localement par SiteProvider).
 * Un seul site accessible : simple libellé, pas de choix inutile.
 */
export function ActiveSitePicker() {
  const { sites, active, setActive, label } = useSite();
  const { isManager, profile } = useAuth();
  const canGroup = isManager || profile?.site_scope === "groupe";
  if (sites.length <= 1 && !canGroup) {
    return <span className="truncate text-xs font-bold uppercase tracking-wide" data-testid="active-site">Site : {label}</span>;
  }
  return (
    <label className="flex min-w-0 items-center gap-1 text-xs font-bold uppercase tracking-wide">
      <span className="opacity-80">Site :</span>
      <select
        aria-label="Site actif"
        data-testid="active-site"
        value={active}
        onChange={(e) => setActive(e.target.value)}
        className="max-w-[11rem] truncate rounded-md border border-brand-foreground/30 bg-brand px-1 py-0.5 text-xs font-bold uppercase text-brand-foreground"
      >
        {sites.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
        {canGroup ? <option value="groupe">{GROUP_LABEL} (groupe)</option> : null}
      </select>
    </label>
  );
}
