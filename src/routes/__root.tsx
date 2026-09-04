import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import {
  clearRecoveryFlag,
  describeClientError,
  isStaleAssetError,
  migrateLocalState,
  recoverStaleClient,
  shouldAutoRecover,
} from "../lib/client-recovery";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth";
import { SiteProvider } from "@/lib/site-context";
import { AuthGate } from "@/components/AuthGate";
import { ModuleGate } from "@/components/ModuleGate";
import { TopBar, TopBarSpacer } from "@/components/TopBar";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const stale = isStaleAssetError(error);

  useEffect(() => {
    // Journalisation exploitable : message, pile, route et nature de la panne.
    console.error(
      "[dda] écran d'erreur global",
      describeClientError(error, { route: window.location.pathname }),
    );
    reportLovableError(error, {
      boundary: "tanstack_root_error_component",
      staleAsset: isStaleAssetError(error),
    });
  }, [error]);

  // Bundle/chunk périmé (cache Chrome Android ou service worker PWA) :
  // relancer le même chunk mort ne sert à rien, on purge et on recharge —
  // une seule fois par session pour ne jamais boucler.
  useEffect(() => {
    if (!stale) return;
    if (!shouldAutoRecover(window.sessionStorage)) return;
    void recoverStaleClient();
  }, [stale]);

  const retry = () => {
    // Réinitialise uniquement l'état fautif : données locales incompatibles,
    // puis relance réellement le chargement de la route.
    migrateLocalState(window.localStorage);
    clearRecoveryFlag(window.sessionStorage);
    if (stale) {
      void recoverStaleClient();
      return;
    }
    void router.invalidate();
    reset();
  };


  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={retry}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "DDA Connect — Tour Véhicule atelier" },
      {
        name: "description",
        content:
          "DDA Connect : application atelier Damien Digoin Automobile pour les tours véhicule, contrôles et rapports.",
      },
      { name: "author", content: "Damien Digoin Automobile" },
      { property: "og:title", content: "DDA Connect — Tour Véhicule atelier" },
      {
        property: "og:description",
        content: "Contrôles véhicule, photos et rapports atelier depuis le smartphone.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // Nettoyage ciblé des données locales héritées d'une ancienne version
  // (Chrome Android / PWA) avant tout rendu de parcours métier.
  useEffect(() => {
    const { removed } = migrateLocalState(window.localStorage);
    if (removed.length) console.warn("[dda] état local incompatible nettoyé", removed);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SiteProvider>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <AuthGate>
            <ModuleGate>
              <TopBar />
              <TopBarSpacer>
                <Outlet />
              </TopBarSpacer>
            </ModuleGate>
          </AuthGate>
          <Toaster position="top-center" richColors />
        </SiteProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
