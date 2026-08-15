import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Connexion — DDA Connect" },
      {
        name: "description",
        content: "Connectez-vous à DDA Connect avec votre compte Google professionnel.",
      },
      { property: "og:title", content: "Connexion — DDA Connect" },
      { property: "og:description", content: "Accès sécurisé à la plateforme atelier DDA Connect." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { user, isActive, loading, profile, signInWithGoogle, signOut } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user && isActive) navigate({ to: "/", replace: true });
  }, [loading, user, isActive, navigate]);

  async function connect() {
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      console.error(e);
      toast.error("Connexion impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            DDA <span className="text-brand">Connect</span>
          </h1>
        </div>

        {user && !isActive ? (
          <div className="card-surface space-y-2 p-5 text-sm">
            <p className="text-base font-bold uppercase">
              {profile?.status === "disabled" ? "Compte désactivé" : "En attente de validation"}
            </p>
            <p className="text-muted-foreground">
              Votre compte DDA Connect a été créé. Un manager doit maintenant autoriser votre accès.
            </p>
            <button
              onClick={() => void signOut()}
              className="mt-2 w-full rounded-xl border-2 border-border bg-card px-4 py-3 text-xs font-bold uppercase"
            >
              Se déconnecter
            </button>
          </div>
        ) : (
          <button
            onClick={() => void connect()}
            disabled={busy || loading}
            className="flex w-full items-center justify-center gap-3 rounded-xl bg-brand px-4 py-4 text-sm font-extrabold uppercase tracking-wide text-brand-foreground disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <GoogleIcon />}
            Se connecter avec Google
          </button>
        )}

        <p className="text-xs text-muted-foreground">
          Réservé aux salariés du garage. Aucun mot de passe Google n'est conservé.
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2.5 24 .5 14.6.5 6.5 5.9 2.6 13.7l7.8 6.1C12.3 13.7 17.6 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-2.8-.4-4.1H24v7.8h12.7c-.3 2.1-1.6 5.2-4.7 7.3l7.2 5.6c4.3-4 7.3-9.9 7.3-16.6z" />
      <path fill="#FBBC05" d="M10.4 28.2a14 14 0 0 1 0-8.4l-7.8-6.1a23.5 23.5 0 0 0 0 20.6l7.8-6.1z" />
      <path fill="#34A853" d="M24 47.5c6.2 0 11.5-2 15.2-5.6l-7.2-5.6c-2 1.3-4.6 2.3-8 2.3-6.4 0-11.7-4.2-13.6-10l-7.8 6.1C6.5 42.1 14.6 47.5 24 47.5z" />
    </svg>
  );
}
