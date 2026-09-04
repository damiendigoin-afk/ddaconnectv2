import { Component, type ReactNode } from "react";

/**
 * Isole une carte du parcours : une exception de rendu reste locale et
 * n'affiche jamais l'écran d'erreur global « Cette page n'a pas pu être chargée ».
 */
export class LocalErrorBoundary extends Component<
  { children: ReactNode; label: string; fallback?: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    const err = error as { name?: string; message?: string } | null;
    console.error("[dda] carte isolée en échec", {
      label: this.props.label,
      errorName: err?.name ?? "Error",
      errorMessage: typeof err?.message === "string" ? err.message.slice(0, 200) : "inconnue",
    });
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      this.props.fallback ?? (
        <div className="card-surface space-y-2 border-2 border-destructive p-4">
          <p className="text-sm font-semibold">{this.props.label} : affichage interrompu.</p>
          <button
            type="button"
            onClick={() => this.setState({ failed: false })}
            className="rounded-lg bg-primary px-3 py-2 text-sm font-bold uppercase text-primary-foreground"
          >
            Réessayer
          </button>
        </div>
      )
    );
  }
}
