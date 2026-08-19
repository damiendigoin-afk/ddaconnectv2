import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

export function AppShell({
  title,
  subtitle,
  back,
  right,
  children,
}: {
  title: string;
  subtitle?: string | undefined;
  back?: { to: string; params?: Record<string, string> };
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-10 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          {back ? (
            <Link
              to={back.to}
              params={back.params as never}
              className="-ml-2 flex h-10 w-10 items-center justify-center rounded-lg text-foreground hover:bg-secondary"
              aria-label="Retour"
            >
              <ChevronLeft className="h-6 w-6" />
            </Link>
          ) : (
            <div className="h-9 w-1.5 rounded-full bg-brand" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold uppercase tracking-wide">{title}</h1>
            {subtitle ? (
              <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          {right}
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-4">{children}</main>
    </div>
  );
}